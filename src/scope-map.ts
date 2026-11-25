import {
  drainMap,
  flushMap,
  flushMapKey,
  guardDisposed,
  type MapScopeState,
  moveMap,
  removeMapEntry,
  ScopeBase,
  setMapEntry,
} from "./core.ts";
import type { DisposableLike, ScopeMap, ScopeOptions } from "./types.ts";
import type { ScopeEntry } from "./utils.ts";

class ScopeMapImpl<K> extends ScopeBase implements ScopeMap<K>, MapScopeState<K> {
  items_?: Map<K, ScopeEntry>;

  constructor(options?: ScopeOptions) {
    super(drainMap, options);
  }

  get [Symbol.toStringTag](): string {
    return "ScopeMap";
  }

  get size(): number {
    return this.items_ ? this.items_.size : 0;
  }

  use<T extends DisposableLike | null | undefined>(key: K, value: T): T {
    guardDisposed(this, value);
    if (value == null) {
      flushMapKey(this, key);
      return value;
    }
    const existing = this.items_?.get(key);
    if (!existing || existing.f || !Object.is(existing.v, value)) {
      flushMapKey(this, key);
      setMapEntry(this, key, { v: value });
    }
    return value;
  }

  adopt<T>(key: K, value: T, onDispose: (value: T) => void): T {
    guardDisposed(this, value, onDispose);
    flushMapKey(this, key);
    setMapEntry(this, key, { v: value, f: onDispose });
    return value;
  }

  defer(key: K, onDispose: () => void): void {
    guardDisposed(this, onDispose);
    flushMapKey(this, key);
    setMapEntry(this, key, { v: onDispose });
  }

  get(key: K): unknown {
    return this.items_?.get(key)?.v;
  }

  has(key: K): boolean {
    return !!this.items_?.has(key);
  }

  keys(): IterableIterator<K> {
    return this.items_ ? this.items_.keys() : ([].values() as IterableIterator<K>);
  }

  remove(key: K): unknown {
    return removeMapEntry(this, key)?.v;
  }

  flush(...args: [key?: K]): void {
    flushMap(this, args);
  }

  move(): ScopeMap<K> {
    return moveMap(this, new ScopeMapImpl<K>());
  }
}

/**
 * Create a keyed refreshable disposal scope. Replacing an existing key disposes its previous resource first.
 */
export function scopeMap<K = unknown>(options?: ScopeOptions): ScopeMap<K> {
  return new ScopeMapImpl<K>(options);
}
