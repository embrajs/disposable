import { assertAlive, flushScope, type OnDisposeHook, ScopeBase } from "./core.ts";
import { clearDevChildren, linkDevValue, registerDevScope, unlinkDevValue } from "./dev.ts";
import type { DisposableLike, ScopeOne, ScopeOptions } from "./types.ts";
import { disposeEntry, isDisposable, type ScopeEntry, SYM_ON_DISPOSE } from "./utils.ts";

function drainOne<T>(s: ScopeOneImpl<T>): unknown[] | undefined {
  const entry = s.entry_;
  if (entry) {
    s.entry_ = null;
    if (__DEV__) {
      clearDevChildren(s);
    }
    try {
      disposeEntry(entry);
    } catch (err) {
      return [err];
    }
  }
}

class ScopeOneImpl<T> extends ScopeBase implements ScopeOne<T> {
  entry_?: ScopeEntry | null;

  constructor(options?: ScopeOptions) {
    super(drainOne);
    if (__DEV__) {
      registerDevScope(this, "scopeOne", options?.name);
    }
  }

  get size(): 0 | 1 {
    return this.entry_ ? 1 : 0;
  }

  get current(): T | undefined {
    return this.entry_?.v as T | undefined;
  }

  use<V extends (T & DisposableLike) | null | undefined>(value: V): V {
    assertAlive(this);
    const existing = this.entry_;
    if (value == null) {
      this.flush();
      return value;
    }
    if (!existing || existing.f || existing.v !== value) {
      this.flush();
      const entry: ScopeEntry = { v: value };
      const hook = (value as { dispose?: Record<symbol, OnDisposeHook> }).dispose?.[SYM_ON_DISPOSE];
      if (hook) {
        const unsub = hook(() => {
          if (this.entry_ === entry) {
            this.entry_ = null;
          }
        });
        if (!unsub) return value;
        entry.u = unsub;
      }
      this.entry_ = entry;
      if (__DEV__) {
        linkDevValue(this, value);
      }
    }
    return value;
  }

  adopt<V extends T>(value: V, onDispose: (value: V) => void): V {
    assertAlive(this);
    this.flush();
    this.entry_ = { v: value, f: onDispose };
    return value;
  }

  is(value: unknown): boolean {
    return !!this.entry_ && Object.is(this.entry_.v, value);
  }

  remove(): T | undefined {
    const entry = this.entry_;
    if (entry) {
      this.entry_ = null;
      entry.u?.();
      if (__DEV__) {
        unlinkDevValue(this, entry);
      }
      return entry.v as T;
    }
  }

  flush(): void {
    flushScope(this, drainOne);
  }
}

/**
 * Create a single-slot refreshable disposal scope. Setting a new resource disposes the previous one first.
 */
export function scopeOne<T = unknown>(options?: ScopeOptions): ScopeOne<T>;
export function scopeOne<T extends DisposableLike>(initial: T, options?: ScopeOptions): ScopeOne<T>;
export function scopeOne<T = unknown>(
  initialOrOptions?: (T & DisposableLike) | ScopeOptions | null | undefined,
  maybeOptions?: ScopeOptions,
): ScopeOne<T> {
  if (isDisposable(initialOrOptions)) {
    const s = new ScopeOneImpl<T>(maybeOptions);
    s.use(initialOrOptions as T & DisposableLike);
    return s;
  }
  return new ScopeOneImpl<T>((initialOrOptions as ScopeOptions | undefined) ?? maybeOptions);
}
