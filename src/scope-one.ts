import { attachChild, detachChild, flushScope, guardDisposed, moveScope, ScopeBase } from "./core.ts";
import type { DisposableLike, ScopeOne, ScopeOptions } from "./types.ts";
import { disposeEntry, isDisposable, type ScopeEntry } from "./utils.ts";

function setOneEntry<T>(s: ScopeOneImpl<T>, entry: ScopeEntry): void {
  s.entry_ = entry;
  attachChild(s, entry, () => {
    s.entry_ = undefined;
  });
}

function drainOne<T>(s: ScopeOneImpl<T>): unknown[] | undefined {
  const entry = s.entry_;
  if (!entry) {
    return undefined;
  }
  s.entry_ = undefined;
  detachChild(entry);
  try {
    disposeEntry(entry);
  } catch (err) {
    return [err];
  }
  return undefined;
}

class ScopeOneImpl<T> extends ScopeBase implements ScopeOne<T> {
  entry_?: ScopeEntry;

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
    return this.entry_ ? (this.entry_.v as T) : undefined;
  }

  use<V extends (T & DisposableLike) | null | undefined>(value: V): V {
    guardDisposed(this, value);
    if (value == null) {
      this.flush();
      return value;
    }
    if (!this.entry_ || this.entry_.f || !Object.is(this.entry_.v, value)) {
      this.flush();
      setOneEntry(this, { v: value });
    }
    return value;
  }

  adopt<V extends T>(value: V, onDispose: (value: V) => void): V {
    guardDisposed(this, value, onDispose);
    this.flush();
    setOneEntry(this, { v: value, f: onDispose });
    return value;
  }

  defer(onDispose: () => void): void {
    guardDisposed(this, onDispose);
    this.flush();
    setOneEntry(this, { v: onDispose });
  }

  is(value: unknown): boolean {
    return !!this.entry_ && Object.is(this.entry_.v, value);
  }

  remove(): T | undefined {
    const entry = this.entry_;
    if (!entry) {
      return undefined;
    }
    this.entry_ = undefined;
    detachChild(entry);
    return entry.v as T;
  }

  flush(): void {
    flushScope(this, drainOne);
  }

  move(): ScopeOne<T> {
    const next = new ScopeOneImpl<T>();
    moveScope(this, next);
    const entry = this.entry_;
    if (entry) {
      this.entry_ = undefined;
      detachChild(entry);
      setOneEntry(next, entry);
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
