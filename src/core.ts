import { getDevDisposedMessage, linkDevChild, markDevDisposed, registerDevScope, unlinkDevChild } from "./dev.ts";
import type { ScopeKind, ScopeOptions } from "./types.ts";
import { disposeEntry, drainEntries, type ScopeEntry, SYM_DISPOSE, throwErrors } from "./utils.ts";

/**
 * Minimal base class for all disposal scopes (shared public getters & `instanceof` identity).
 * Wrapped in a pure IIFE so importing only `dispose` / `isDisposable` tree-shakes `ScopeBase` away.
 * @internal
 */
export interface ScopeBase extends Disposable {
  disposed_: boolean;
  ctrl_: AbortController | null;
  parents_: Set<ScopeEntry> | null;
  readonly disposed: boolean;
  readonly signal: AbortSignal;
  dispose(this: void): void;
}

/** @internal */
export const ScopeBase: new (drain: (s: any) => unknown[] | undefined, options?: ScopeOptions) => ScopeBase =
  /* @__PURE__ */ (() => {
    class Base implements ScopeBase {
      disposed_ = false;
      ctrl_: AbortController | null = null;
      parents_: Set<ScopeEntry> | null = null;
      readonly dispose: (this: void) => void;

      constructor(drain: (s: any) => unknown[] | undefined, options?: ScopeOptions) {
        if (__DEV__) {
          const tag = (this as unknown as Record<symbol, string>)[Symbol.toStringTag];
          const kind = (tag[0].toLowerCase() + tag.slice(1)) as ScopeKind;
          registerDevScope(this, kind, options?.name);
        }
        this.dispose = () => disposeScope(this, drain);
      }

      get disposed(): boolean {
        return this.disposed_;
      }

      get signal(): AbortSignal {
        return this.disposed_
          ? this.ctrl_
            ? this.ctrl_.signal
            : AbortSignal.abort()
          : (this.ctrl_ ??= new AbortController()).signal;
      }

      [SYM_DISPOSE](): void {
        this.dispose();
      }
    }
    return Base;
  })();

/**
 * Shared state shape for Map-backed scopes (`ScopeSet` and `ScopeMap`).
 * @internal
 */
export interface MapScopeState<K> extends ScopeBase {
  items_: Map<K, ScopeEntry> | null;
}

/** @internal */
export function detachFromParents(child: ScopeBase): void {
  const parents = child.parents_;
  if (parents) {
    child.parents_ = null;
    for (const entry of parents) {
      const parent = entry.p as ScopeBase;
      entry.p = null;
      if (__DEV__) {
        unlinkDevChild(parent, child);
      }
      (entry.r as (parent: any, entry: ScopeEntry) => void)(parent, entry);
    }
  }
}

/** @internal */
export function attachChild(
  parent: ScopeBase,
  entry: ScopeEntry,
  unlink: (parent: any, entry: ScopeEntry) => void,
  key?: unknown,
): void {
  if (!entry.f && entry.v instanceof ScopeBase && !entry.v.disposed_) {
    const child = entry.v;
    entry.p = parent;
    entry.r = unlink;
    entry.k = key;
    (child.parents_ ??= new Set()).add(entry);
    if (__DEV__) {
      linkDevChild(parent, child);
    }
  }
}

/** @internal */
export function detachChild(entry: ScopeEntry): void {
  const parent = entry.p as ScopeBase | null | undefined;
  if (parent) {
    entry.p = null;
    const child = entry.v as ScopeBase;
    child.parents_?.delete(entry);
    if (__DEV__) {
      unlinkDevChild(parent, child);
    }
  }
}

/** @internal */
export function disposeScope<S extends ScopeBase>(s: S, drain: (s: S) => unknown[] | undefined): void {
  if (!s.disposed_) {
    s.disposed_ = true;
    if (__DEV__) {
      markDevDisposed(s, "disposed");
    }
    detachFromParents(s);
    const errors = drain(s);
    s.ctrl_?.abort();
    throwErrors(errors);
  }
}

/** @internal */
export function flushScope<S extends ScopeBase>(s: S, drain: (s: S) => unknown[] | undefined): void {
  if (!s.disposed_) {
    throwErrors(drain(s));
  }
}

/** @internal */
export function moveScope<T extends ScopeBase>(from: ScopeBase, to: T): T {
  if (from.disposed_) {
    throwDisposed(from);
  }
  from.disposed_ = true;
  if (__DEV__) {
    markDevDisposed(from, "moved");
  }
  detachFromParents(from);
  if (from.ctrl_) {
    to.ctrl_ = from.ctrl_;
    from.ctrl_ = null;
  }
  return to;
}

/** @internal */
export function throwDisposed(s: ScopeBase): never {
  let message = "disposed";
  if (__DEV__) {
    message = getDevDisposedMessage(s);
  }
  throw new ReferenceError(message);
}

/** @internal */
export function removeMapEntry<K>(s: MapScopeState<K>, key: K): ScopeEntry | undefined {
  const items = s.items_;
  if (items) {
    const entry = items.get(key);
    if (entry) {
      items.delete(key);
      detachChild(entry);
      return entry;
    }
  }
}

/** @internal */
export function flushMapKey<K>(s: MapScopeState<K>, key: K): void {
  const entry = removeMapEntry(s, key);
  if (entry) {
    disposeEntry(entry);
  }
}

const unlinkMap = (s: MapScopeState<unknown>, entry: ScopeEntry): void => {
  (s.items_ as Map<unknown, ScopeEntry>).delete(entry.k);
};

/** @internal */
export function setMapEntry<K>(s: MapScopeState<K>, key: K, entry: ScopeEntry): void {
  (s.items_ ??= new Map()).set(key, entry);
  attachChild(s, entry, unlinkMap, key);
}

/** @internal */
export function drainMap<K>(s: MapScopeState<K>): unknown[] | undefined {
  const items = s.items_;
  s.items_ = null;
  if (items && items.size > 0) {
    const entries = new Array<ScopeEntry>(items.size);
    let i = 0;
    for (const entry of items.values()) {
      detachChild(entry);
      entries[i++] = entry;
    }
    return drainEntries(entries);
  }
}

/** @internal */
export function moveMap<K, T extends MapScopeState<K>>(from: MapScopeState<K>, to: T): T {
  moveScope(from, to);
  const items = from.items_;
  if (items) {
    from.items_ = null;
    to.items_ = items;
    for (const [key, entry] of items) {
      detachChild(entry);
      attachChild(to, entry, unlinkMap, key);
    }
  }
  return to;
}
