import {
  drainMap,
  flushMapKey,
  flushScope,
  type MapScopeState,
  moveMap,
  removeMapEntry,
  ScopeBase,
  setMapEntry,
  throwDisposed,
} from "./core.ts";
import type { DisposableLike, ScopeOptions, ScopeSet } from "./types.ts";
import { createIterableScope, type ScopeEntry } from "./utils.ts";

class ScopeSetImpl extends ScopeBase implements ScopeSet, MapScopeState<unknown> {
  items_: Map<unknown, ScopeEntry> | null = null;

  constructor(options?: ScopeOptions) {
    super(drainMap, options);
  }

  get [Symbol.toStringTag](): string {
    return "ScopeSet";
  }

  get size(): number {
    return this.items_ ? this.items_.size : 0;
  }

  use<T extends DisposableLike | null | undefined>(value: T): T {
    if (this.disposed_) {
      throwDisposed(this);
    }
    if (value != null && !this.has(value)) {
      setMapEntry(this, value, { v: value });
    }
    return value;
  }

  adopt<T>(value: T, onDispose: (value: T) => void): T {
    if (this.disposed_) {
      throwDisposed(this);
    }
    if (!this.has(value)) {
      (this.items_ ??= new Map()).set(value, { v: value, f: onDispose });
    }
    return value;
  }

  defer(onDispose: () => void): void {
    if (this.disposed_) {
      throwDisposed(this);
    }
    if (!this.has(onDispose)) {
      (this.items_ ??= new Map()).set(onDispose, { v: onDispose });
    }
  }

  has(value: unknown): boolean {
    return !!this.items_?.has(value);
  }

  remove(value: unknown): boolean {
    return !!removeMapEntry(this, value);
  }

  flush(value?: unknown): void {
    if (value !== undefined) {
      flushMapKey(this, value);
    } else {
      flushScope(this, drainMap);
    }
  }

  move(): ScopeSet {
    return moveMap(this, new ScopeSetImpl());
  }
}

/**
 * Create a deduplicated disposal scope keyed by resource reference.
 */
export function scopeSet(options?: ScopeOptions): ScopeSet;
export function scopeSet(items: Iterable<DisposableLike | null | undefined>, options?: ScopeOptions): ScopeSet;
export function scopeSet(
  itemsOrOptions?: Iterable<DisposableLike | null | undefined> | ScopeOptions,
  maybeOptions?: ScopeOptions,
): ScopeSet {
  return createIterableScope(ScopeSetImpl, itemsOrOptions, maybeOptions);
}
