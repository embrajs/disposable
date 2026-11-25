import { attachChild, detachChild, flushScope, moveScope, ScopeBase, throwDisposed } from "./core.ts";
import type { DisposableLike, ScopeOne, ScopeOptions } from "./types.ts";
import { disposeEntry, isDisposable, type ScopeEntry } from "./utils.ts";

const unlinkOne = <T>(s: ScopeOneImpl<T>): void => {
  s.entry_ = null;
};

function drainOne<T>(s: ScopeOneImpl<T>): unknown[] | undefined {
  const entry = s.entry_;
  if (entry) {
    s.entry_ = null;
    detachChild(entry);
    try {
      disposeEntry(entry);
    } catch (err) {
      return [err];
    }
  }
}

class ScopeOneImpl<T> extends ScopeBase implements ScopeOne<T> {
  entry_: ScopeEntry | null = null;

  constructor(options?: ScopeOptions) {
    super(drainOne, options);
  }

  get [Symbol.toStringTag](): string {
    return "ScopeOne";
  }

  get size(): 0 | 1 {
    return this.entry_ ? 1 : 0;
  }

  get current(): T | undefined {
    return this.entry_?.v as T | undefined;
  }

  use<V extends (T & DisposableLike) | null | undefined>(value: V): V {
    if (this.disposed_) {
      throwDisposed(this);
    }
    const existing = this.entry_;
    if (value == null) {
      if (existing) {
        this.flush();
      }
      return value;
    }
    if (!existing || existing.f || !Object.is(existing.v, value)) {
      if (existing) {
        this.flush();
      }
      const entry: ScopeEntry = { v: value };
      this.entry_ = entry;
      attachChild(this, entry, unlinkOne);
    }
    return value;
  }

  adopt<V extends T>(value: V, onDispose: (value: V) => void): V {
    if (this.disposed_) {
      throwDisposed(this);
    }
    if (this.entry_) {
      this.flush();
    }
    this.entry_ = { v: value, f: onDispose };
    return value;
  }

  defer(onDispose: () => void): void {
    if (this.disposed_) {
      throwDisposed(this);
    }
    if (this.entry_) {
      this.flush();
    }
    this.entry_ = { v: onDispose };
  }

  is(value: unknown): boolean {
    return !!this.entry_ && Object.is(this.entry_.v, value);
  }

  remove(): T | undefined {
    const entry = this.entry_;
    if (entry) {
      this.entry_ = null;
      detachChild(entry);
      return entry.v as T;
    }
  }

  flush(): void {
    flushScope(this, drainOne);
  }

  move(): ScopeOne<T> {
    const next = new ScopeOneImpl<T>();
    moveScope(this, next);
    const entry = this.entry_;
    if (entry) {
      this.entry_ = null;
      detachChild(entry);
      next.entry_ = entry;
      attachChild(next, entry, unlinkOne);
    }
    return next;
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
