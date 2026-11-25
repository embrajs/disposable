import type { DisposableLike, Disposer, IDisposable } from "./types.ts";

/**
 * Standard `Symbol.dispose` with fallback to `Symbol.for("Symbol.dispose")` for older runtimes.
 */
/* v8 ignore start */
export const SYM_DISPOSE: typeof Symbol.dispose =
  Symbol.dispose ?? /* @__PURE__ */ (Symbol.for("Symbol.dispose") as typeof Symbol.dispose);
/* v8 ignore stop */

/** @internal */
export const isFn = (v: unknown): v is (...args: any[]) => any => typeof v === "function";

/**
 * Check whether a value is a {@link DisposableLike} (a function, a TC39 `Disposable`, or an `IDisposable`).
 */
export const isDisposable = (value: unknown): value is DisposableLike =>
  isFn(value) || isFn((value as Disposable)?.[SYM_DISPOSE]) || isFn((value as IDisposable)?.dispose);

/**
 * Dispose a {@link DisposableLike} value. No-op for `null` or `undefined`.
 * Errors thrown during disposal are propagated rather than swallowed.
 */
export function dispose(value: unknown): void {
  if (value) {
    if (isFn(value)) {
      (value as Disposer)();
    } else if (isFn((value as Disposable)[SYM_DISPOSE])) {
      (value as Disposable)[SYM_DISPOSE]();
    } else if (isFn((value as IDisposable).dispose)) {
      (value as IDisposable).dispose();
    }
  }
}

/**
 * Internal entry stored in disposal scopes.
 * @internal
 */
export interface ScopeEntry {
  /** Managed resource or disposer function. */
  v: unknown;
  /** Optional custom cleanup callback from `adopt()`. */
  f?: (value: any) => void;
  /** Parent scope when this entry holds a live child scope. */
  p?: unknown;
  /** Static unlink callback for removing this entry from its parent on child disposal. */
  r?: (parent: any, entry: ScopeEntry) => void;
  /** Map key when stored in a Map-backed scope. */
  k?: unknown;
}

/**
 * Run a single entry's cleanup function.
 * @internal
 */
export const disposeEntry = (entry: ScopeEntry): void => (entry.f ? entry.f(entry.v) : dispose(entry.v));

/**
 * Run an array of entries in LIFO order, collecting any thrown errors.
 * @internal
 */
export function drainEntries(entries: ScopeEntry[]): unknown[] | undefined {
  let errors: unknown[] | undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    try {
      disposeEntry(entries[i]);
    } catch (err) {
      (errors ??= []).push(err);
    }
  }
  return errors;
}

/**
 * Throw collected disposal errors: rethrows a single error directly, or an `AggregateError` for multiple errors.
 * @internal
 */
export function throwErrors(errors: unknown[] | undefined): void {
  if (errors) {
    throw errors.length === 1 ? errors[0] : new AggregateError(errors);
  }
}

/**
 * Shared factory helper for iterable-or-options scope constructors.
 * @internal
 */
export function createIterableScope<T extends { use(v: DisposableLike | null | undefined): unknown }>(
  Ctor: new (options?: { name?: string }) => T,
  itemsOrOptions?: Iterable<DisposableLike | null | undefined> | { name?: string },
  maybeOptions?: { name?: string },
): T {
  const isIter = itemsOrOptions != null && isFn((itemsOrOptions as Iterable<unknown>)[Symbol.iterator]);
  const s = new Ctor(isIter ? maybeOptions : (itemsOrOptions as { name?: string } | undefined));
  if (isIter) {
    for (const item of itemsOrOptions as Iterable<DisposableLike | null | undefined>) {
      s.use(item);
    }
  }
  return s;
}
