/**
 * A function that cleans up a resource when called.
 */
export type Disposer = () => void;

/**
 * An object with a `dispose()` method.
 */
export interface IDisposable {
  dispose(): void;
}

/**
 * Any value that can be disposed: a cleanup function, a TC39 {@link Disposable}, or an {@link IDisposable}.
 */
export type DisposableLike = Disposer | Disposable | IDisposable;

/**
 * Options for creating a disposal scope.
 */
export interface ScopeOptions {
  /**
   * Optional human-readable label for diagnostics and `@embra/disposable/debug`.
   * Ignored in production builds.
   */
  name?: string;
}

/**
 * Kind identifier for disposal scopes.
 */
export type ScopeKind = "scope" | "scopeSet" | "scopeMap" | "scopeOne";

/**
 * Common interface shared by all disposal scopes.
 */
export interface BaseScope extends Disposable {
  /**
   * Whether this scope has been disposed (or moved).
   */
  readonly disposed: boolean;

  /**
   * Number of resources currently managed by this scope.
   */
  readonly size: number;

  /**
   * Lazily created `AbortSignal` that aborts when this scope is disposed.
   */
  readonly signal: AbortSignal;

  /**
   * Dispose all managed resources in LIFO order and permanently close this scope.
   * Safe to pass detached (does not depend on `this`).
   */
  dispose(this: void): void;

  /**
   * Standard TC39 Explicit Resource Management hook (`using`).
   */
  [Symbol.dispose](): void;

  /**
   * Dispose and clear all currently managed resources without closing this scope.
   */
  flush(): void;
}

/**
 * An ordered (LIFO) disposal scope aligned with TC39 `DisposableStack`.
 */
export interface Scope extends BaseScope, DisposableStack {
  /**
   * Register a disposable resource (or `null` / `undefined` as a no-op) and return it.
   */
  use<T extends DisposableLike | null | undefined>(value: T): T;

  /**
   * Register a non-disposable value with an explicit cleanup callback and return the value.
   */
  adopt<T>(value: T, onDispose: (value: T) => void): T;

  /**
   * Register a cleanup callback to run when this scope is disposed or flushed.
   */
  defer(onDispose: () => void): void;

  /**
   * Transfer all managed resources (and any active `AbortSignal`) into a new `Scope`,
   * marking this scope as disposed.
   */
  move(): Scope;
}

/**
 * A deduplicated disposal scope keyed by resource reference.
 */
export interface ScopeSet extends Scope {
  /**
   * Check whether a resource or deferred callback is currently managed by this scope.
   */
  has(value: unknown): boolean;

  /**
   * Remove a resource from this scope without disposing it.
   * @returns `true` if the resource was present and removed.
   */
  remove(value: unknown): boolean;

  /**
   * Dispose and remove a specific resource, or all resources if omitted.
   */
  flush(value?: unknown): void;

  /**
   * Transfer all managed resources into a new `ScopeSet`, marking this scope as disposed.
   */
  move(): ScopeSet;
}

/**
 * A keyed refreshable disposal scope. Replacing an existing key disposes its previous resource first.
 */
export interface ScopeMap<K = unknown> extends BaseScope {
  /**
   * Register a disposable resource under `key` (disposing any previous entry at `key`) and return it.
   * Passing `null` or `undefined` flushes `key` without storing a new entry.
   */
  use<T extends DisposableLike | null | undefined>(key: K, value: T): T;

  /**
   * Register a non-disposable value under `key` with an explicit cleanup callback
   * (disposing any previous entry at `key`) and return the value.
   */
  adopt<T>(key: K, value: T, onDispose: (value: T) => void): T;

  /**
   * Register a cleanup callback under `key` (disposing any previous entry at `key`).
   */
  defer(key: K, onDispose: () => void): void;

  /**
   * Get the resource currently stored under `key`, if any.
   */
  get(key: K): unknown;

  /**
   * Check whether `key` currently has a managed resource.
   */
  has(key: K): boolean;

  /**
   * Return an iterator of all active keys in insertion order.
   */
  keys(): IterableIterator<K>;

  /**
   * Remove the resource at `key` without disposing it.
   * @returns The removed resource, or `undefined` if `key` was not present.
   */
  remove(key: K): unknown;

  /**
   * Dispose and remove the resource at `key`, or all resources if `key` is omitted.
   */
  flush(key?: K): void;

  /**
   * Transfer all managed resources into a new `ScopeMap`, marking this scope as disposed.
   */
  move(): ScopeMap<K>;
}

/**
 * A single-slot refreshable disposal scope. Setting a new resource disposes the previous one first.
 */
export interface ScopeOne<T = unknown> extends BaseScope {
  /**
   * `1` if a resource is currently held, otherwise `0`.
   */
  readonly size: 0 | 1;

  /**
   * The currently managed resource, or `undefined` if empty.
   */
  readonly current: T | undefined;

  /**
   * Replace the current slot with a disposable resource (disposing the previous one first) and return it.
   * Passing `null` or `undefined` flushes the slot.
   */
  use<V extends (T & DisposableLike) | null | undefined>(value: V): V;

  /**
   * Replace the current slot with a non-disposable value and explicit cleanup callback
   * (disposing the previous one first) and return the value.
   */
  adopt<V extends T>(value: V, onDispose: (value: V) => void): V;

  /**
   * Replace the current slot with a cleanup callback (disposing the previous one first).
   */
  defer(onDispose: () => void): void;

  /**
   * Check whether `value` is the currently held resource (using `Object.is`).
   */
  is(value: unknown): boolean;

  /**
   * Remove the current resource without disposing it.
   * @returns The removed resource, or `undefined` if the slot was empty.
   */
  remove(): T | undefined;

  /**
   * Transfer the current resource into a new `ScopeOne`, marking this scope as disposed.
   */
  move(): ScopeOne<T>;
}
