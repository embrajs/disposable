import {
  clearDevChildren,
  getDevDisposedMessage,
  linkDevValue,
  markDevDisposed,
  registerDevScope,
  unlinkDevValue,
} from "./dev.ts";
import type { ScopeKind, ScopeOptions } from "./types.ts";
import { disposeEntry, drainEntries, type ScopeEntry, SYM_DISPOSE, SYM_ON_DISPOSE, throwErrors } from "./utils.ts";

/**
 * Minimal base class for all disposal scopes (shared public getters & `instanceof` identity).
 * Wrapped in a pure IIFE so importing only `dispose` / `isDisposable` tree-shakes `ScopeBase` away.
 * @internal
 */
export interface ScopeBase extends Disposable {
  disposed_: boolean;
  ctrl_: AbortController | null;
  readonly disposed: boolean;
  readonly signal: AbortSignal;
  dispose(this: void): void;
}

/** @internal */
export const ScopeBase: new (
  drain: (s: any) => unknown[] | undefined,
  options?: ScopeOptions,
  kind?: ScopeKind,
) => ScopeBase = /* @__PURE__ */ (() => {
  class Base implements ScopeBase {
    disposed_ = false;
    ctrl_: AbortController | null = null;
    readonly dispose: (this: void) => void;

    constructor(drain: (s: any) => unknown[] | undefined, options?: ScopeOptions, kind?: ScopeKind) {
      this.dispose = () => disposeScope(this, drain);
      if (__DEV__) {
        registerDevScope(this, kind as ScopeKind, options?.name);
      }
    }

    get disposed(): boolean {
      return this.disposed_;
    }

    get signal(): AbortSignal {
      return this.disposed_
        ? (this.ctrl_?.signal ?? AbortSignal.abort())
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
export function disposeScope<S extends ScopeBase>(s: S, drain: (s: S) => unknown[] | undefined): void {
  if (!s.disposed_) {
    s.disposed_ = true;
    if (__DEV__) {
      markDevDisposed(s);
    }
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
export function assertAlive(s: ScopeBase): void {
  if (s.disposed_) {
    let message = "disposed";
    if (__DEV__) {
      message = getDevDisposedMessage(s);
    }
    throw new ReferenceError(message);
  }
}

/** @internal */
export type OnDisposeHook = (cb: () => void) => (() => void) | false;

/** @internal */
export function removeMapEntry<K>(s: MapScopeState<K>, key: K): ScopeEntry | undefined {
  const items = s.items_;
  if (items) {
    const entry = items.get(key);
    if (entry) {
      items.delete(key);
      entry.u?.();
      if (__DEV__) {
        unlinkDevValue(s, entry);
      }
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

/** @internal */
export function setMapEntry<K>(s: MapScopeState<K>, key: K, entry: ScopeEntry): void {
  const hook = (entry.v as { dispose?: Record<symbol, OnDisposeHook> }).dispose?.[SYM_ON_DISPOSE];
  if (hook) {
    const unsub = hook(() => {
      if (s.items_?.get(key) === entry) {
        s.items_.delete(key);
      }
    });
    if (!unsub) return;
    entry.u = unsub;
  }
  (s.items_ ??= new Map()).set(key, entry);
  if (__DEV__) {
    linkDevValue(s, entry.v);
  }
}

/** @internal */
export function drainMap<K>(s: MapScopeState<K>): unknown[] | undefined {
  const items = s.items_;
  s.items_ = null;
  if (items) {
    if (__DEV__) {
      clearDevChildren(s);
    }
    return drainEntries(items.values());
  }
}
