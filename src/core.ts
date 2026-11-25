import { getDevDisposedMessage, linkDevChild, markDevDisposed, registerDevScope, unlinkDevChild } from "./dev.ts";
import type { ScopeKind, ScopeOptions } from "./types.ts";
import { dispose, disposeEntry, drainEntries, type ScopeEntry, SYM_DISPOSE, throwErrors } from "./utils.ts";

/**
 * Minimal base class for all disposal scopes (shared public getters & `instanceof` identity).
 * Wrapped in a pure IIFE so importing only `dispose` / `isDisposable` tree-shakes `ScopeBase` away.
 * @internal
 */
export interface ScopeBase extends Disposable {
  disposed_: boolean;
  ctrl_?: AbortController;
  parents_?: Set<() => void>;
  readonly disposed: boolean;
  readonly signal: AbortSignal;
  dispose(this: void): void;
}

/** @internal */
export const ScopeBase: new (drain: (s: any) => unknown[] | undefined, options?: ScopeOptions) => ScopeBase =
  /* @__PURE__ */ (() => {
    class Base implements ScopeBase {
      disposed_ = false;
      ctrl_?: AbortController;
      parents_?: Set<() => void>;
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
  items_?: Map<K, ScopeEntry>;
}

/** @internal */
export function detachFromParents(s: ScopeBase): void {
  const parents = s.parents_;
  if (parents) {
    s.parents_ = undefined;
    for (const detach of parents) {
      detach();
    }
  }
}

/** @internal */
export function attachChild(parent: ScopeBase, entry: ScopeEntry, onChildDispose: () => void): void {
  if (!entry.f && entry.v instanceof ScopeBase && !entry.v.disposed_) {
    const child = entry.v;
    const detach = () => {
      if (__DEV__) {
        unlinkDevChild(parent, child);
      }
      onChildDispose();
    };
    entry.u = () => {
      child.parents_?.delete(detach);
      if (__DEV__) {
        unlinkDevChild(parent, child);
      }
    };
    (child.parents_ ??= new Set()).add(detach);
    if (__DEV__) {
      linkDevChild(parent, child);
    }
  }
}

/** @internal */
export function detachChild(entry: ScopeEntry): void {
  const unlink = entry.u;
  if (unlink) {
    entry.u = undefined;
    unlink();
  }
}

/** @internal */
export function disposeScope<S extends ScopeBase>(s: S, drain: (s: S) => unknown[] | undefined): void {
  if (s.disposed_) {
    return;
  }
  s.disposed_ = true;
  if (__DEV__) {
    markDevDisposed(s, "disposed");
  }
  detachFromParents(s);
  const errors = drain(s);
  s.ctrl_?.abort();
  throwErrors(errors);
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
    from.ctrl_ = undefined;
  }
  return to;
}

/** @internal */
export function guardDisposed(s: ScopeBase, value: unknown, onDispose?: (v: any) => void): void {
  if (s.disposed_) {
    throwDisposed(s, onDispose ? () => onDispose(value) : value != null ? () => dispose(value) : undefined);
  }
}

/** @internal */
export function throwDisposed(s: ScopeBase, cleanup?: () => void): never {
  let opts: ErrorOptions | undefined;
  if (cleanup) {
    try {
      cleanup();
    } catch (cause) {
      opts = { cause };
    }
  }
  let message = "Cannot use a disposed scope";
  if (__DEV__) {
    message = getDevDisposedMessage(s);
  }
  throw new ReferenceError(message, opts);
}

/** @internal */
export function removeMapEntry<K>(s: MapScopeState<K>, key: K): ScopeEntry | undefined {
  const items = s.items_;
  const entry = items?.get(key);
  if (entry) {
    items?.delete(key);
    detachChild(entry);
  }
  return entry;
}

/** @internal */
export function flushMapKey<K>(s: MapScopeState<K>, key: K): void {
  const entry = removeMapEntry(s, key);
  if (entry) {
    disposeEntry(entry);
  }
}

/** @internal */
export function flushMap<K>(s: MapScopeState<K>, args: [key?: K]): void {
  if (s.disposed_) {
    return;
  }
  if (args.length > 0) {
    flushMapKey(s, args[0] as K);
    return;
  }
  throwErrors(drainMap(s));
}

/** @internal */
export function setMapEntry<K>(s: MapScopeState<K>, key: K, entry: ScopeEntry): void {
  const items = (s.items_ ??= new Map());
  items.set(key, entry);
  attachChild(s, entry, () => {
    items.delete(key);
  });
}

/** @internal */
export function drainMap<K>(s: MapScopeState<K>): unknown[] | undefined {
  const items = s.items_;
  if (!items || items.size === 0) {
    s.items_ = undefined;
    return undefined;
  }
  s.items_ = undefined;
  const entries: ScopeEntry[] = [];
  for (const entry of items.values()) {
    detachChild(entry);
    entries.push(entry);
  }
  return drainEntries(entries);
}

/** @internal */
export function moveMap<K, T extends MapScopeState<K>>(from: MapScopeState<K>, to: T): T {
  moveScope(from, to);
  const items = from.items_;
  if (items) {
    from.items_ = undefined;
    for (const [key, entry] of items) {
      detachChild(entry);
      setMapEntry(to, key, entry);
    }
  }
  return to;
}
