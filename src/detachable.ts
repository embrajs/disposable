import { aliasDevDispose } from "./dev.ts";
import type { DetachableDisposer, Disposer } from "./types.ts";
import { isFn, SYM_DISPOSE, SYM_ON_DISPOSE } from "./utils.ts";

/**
 * Wrap a cleanup function so calling it early automatically detaches it from any containing scopes.
 *
 * The returned function is idempotent, pre-bound, and implements `Disposer`, `IDisposable`,
 * and TC39 `Disposable` (`using`).
 */
export function detachable(onDispose: Disposer): DetachableDisposer {
  let listeners: (() => void) | (() => void)[] | null = null;

  const fn = (): void => {
    const d = onDispose;
    if (!d) return;
    (onDispose as Disposer | null) = null;
    const l = listeners;
    listeners = null;
    if (l) {
      if (isFn(l)) {
        l();
      } else {
        for (const cb of l) {
          cb();
        }
      }
    }
    d();
  };

  fn.dispose = fn;
  (fn as unknown as Record<symbol, unknown>)[SYM_DISPOSE] = fn;
  (fn as unknown as Record<symbol, unknown>)[SYM_ON_DISPOSE] = (cb: () => void): (() => void) | false => {
    if (!onDispose) return false;
    if (!listeners) {
      listeners = cb;
    } else if (isFn(listeners)) {
      listeners = [listeners, cb];
    } else {
      listeners.push(cb);
    }
    return () => {
      if (listeners === cb) {
        listeners = null;
      } else {
        const idx = (listeners as (() => void)[] | null)?.indexOf?.(cb) as number;
        if (idx >= 0) {
          (listeners as (() => void)[]).splice(idx, 1);
        }
      }
    };
  };

  if (__DEV__) {
    aliasDevDispose(fn, onDispose);
  }

  return fn as unknown as DetachableDisposer;
}
