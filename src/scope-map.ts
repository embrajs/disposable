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
import type { DisposableLike, ScopeMap, ScopeOptions } from "./types.ts";
import type { ScopeEntry } from "./utils.ts";

class ScopeMapImpl<K> extends ScopeBase implements ScopeMap<K>, MapScopeState<K> {
  items_: Map<K, ScopeEntry> | null = null;

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
    if (this.disposed_) {
      throwDisposed(this);
    }
    if (value == null) {
      flushMapKey(this, key);
      return value;
    }
    const existing = this.items_?.get(key);
    if (!existing || existing.f || !Object.is(existing.v, value)) {
      if (existing) {
        flushMapKey(this, key);
      }
      setMapEntry(this, key, { v: value });
    }
    return value;
  }

  adopt<T>(key: K, value: T, onDispose: (value: T) => void): T {
    if (this.disposed_) {
      throwDisposed(this);
    }
    flushMapKey(this, key);
    (this.items_ ??= new Map()).set(key, { v: value, f: onDispose });
    return value;
  }

  defer(key: K, onDispose: () => void): void {
    if (this.disposed_) {
      throwDisposed(this);
    }
    flushMapKey(this, key);
    (this.items_ ??= new Map()).set(key, { v: onDispose });
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

  flush(key?: K): void {
    if (key !== undefined) {
      flushMapKey(this, key);
    } else {
      flushScope(this, drainMap);
    }
  }

  move(): ScopeMap<K> {
    return moveMap(this, new ScopeMapImpl<K>());
  }
}

/**
 * Create a keyed refreshable disposal scope. Replacing an existing key disposes its previous resource first.
 */
export const scopeMap = <K = unknown>(options?: ScopeOptions): ScopeMap<K> => new ScopeMapImpl<K>(options);
