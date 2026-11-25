import {
  assertAlive,
  drainMap,
  flushMapKey,
  flushScope,
  type MapScopeState,
  removeMapEntry,
  ScopeBase,
  setMapEntry,
} from "./core.ts";
import { registerDevScope } from "./dev.ts";
import type { DisposableLike, ScopeOptions, ScopeSet } from "./types.ts";
import { createIterableScope, type ScopeEntry } from "./utils.ts";

class ScopeSetImpl extends ScopeBase implements ScopeSet, MapScopeState<unknown> {
  items_?: Map<unknown, ScopeEntry> | null;

  constructor(options?: ScopeOptions) {
    super(drainMap);
    if (__DEV__) {
      registerDevScope(this, "scopeSet", options?.name);
    }
  }

  get size(): number {
    return this.items_?.size ?? 0;
  }

  use<T extends DisposableLike | null | undefined>(value: T): T {
    assertAlive(this);
    if (value != null && !this.has(value)) {
      setMapEntry(this, value, { v: value });
    }
    return value;
  }

  adopt<T>(value: T, onDispose: (value: T) => void): T {
    assertAlive(this);
    if (!this.has(value)) {
      (this.items_ ??= new Map()).set(value, { v: value, f: onDispose });
    }
    return value;
  }

  has(value: unknown): boolean {
    return !!this.items_?.has(value);
  }

  remove(value: unknown): boolean {
    return !!removeMapEntry(this, value);
  }

  flush(): void;
  flush(value: unknown): void;
  flush(value?: unknown): void {
    if (arguments.length > 0) {
      flushMapKey(this, value);
    } else {
      flushScope(this, drainMap);
    }
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
