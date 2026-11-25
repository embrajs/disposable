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
import type { DisposableLike, ScopeMap, ScopeOptions } from "./types.ts";
import type { ScopeEntry } from "./utils.ts";

class ScopeMapImpl<K> extends ScopeBase implements ScopeMap<K>, MapScopeState<K> {
  items_: Map<K, ScopeEntry> | null = null;

  constructor(options?: ScopeOptions) {
    super(drainMap, options, __DEV__ ? "scopeMap" : undefined);
  }

  get size(): number {
    return this.items_?.size ?? 0;
  }

  use<T extends DisposableLike | null | undefined>(key: K, value: T): T {
    assertAlive(this);
    if (value == null) {
      flushMapKey(this, key);
      return value;
    }
    const existing = this.items_?.get(key);
    if (!existing || existing.f || existing.v !== value) {
      if (existing) {
        flushMapKey(this, key);
      }
      setMapEntry(this, key, { v: value });
    }
    return value;
  }

  adopt<T>(key: K, value: T, onDispose: (value: T) => void): T {
    assertAlive(this);
    flushMapKey(this, key);
    (this.items_ ??= new Map()).set(key, { v: value, f: onDispose });
    return value;
  }

  get(key: K): unknown {
    return this.items_?.get(key)?.v;
  }

  has(key: K): boolean {
    return !!this.items_?.has(key);
  }

  keys(): IterableIterator<K> {
    return ((this.items_ ?? [] as K[]) as unknown as Map<K, unknown>).keys();
  }

  remove(key: K): unknown {
    return removeMapEntry(this, key)?.v;
  }

  flush(): void;
  flush(key: K): void;
  flush(key?: K): void {
    if (arguments.length > 0) {
      flushMapKey(this, key as K);
    } else {
      flushScope(this, drainMap);
    }
  }
}

/**
 * Create a keyed refreshable disposal scope. Replacing an existing key disposes its previous resource first.
 */
export const scopeMap = <K = unknown>(options?: ScopeOptions): ScopeMap<K> => new ScopeMapImpl<K>(options);
