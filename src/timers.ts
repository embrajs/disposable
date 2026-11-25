import { toDisposable } from "./to-disposable.ts";
import type { ManagedDisposer } from "./types.ts";

/**
 * Schedule a one-shot timer (`setTimeout`) returning a managed disposer that cancels the timer
 * and automatically detaches from any containing scopes once it fires or is cancelled early.
 */
export function timeout(fn: () => void, ms?: number): ManagedDisposer {
  const stop = toDisposable(() => clearTimeout(id));
  const id = setTimeout(() => {
    stop();
    fn();
  }, ms);
  return stop;
}

/**
 * Schedule a repeating timer (`setInterval`) returning a managed disposer that clears the interval
 * and automatically detaches from any containing scopes if cancelled early.
 */
export function interval(fn: () => void, ms?: number): ManagedDisposer {
  const id = setInterval(fn, ms);
  return toDisposable(() => clearInterval(id));
}
