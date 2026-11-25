import { attachChild, detachChild, flushScope, moveScope, ScopeBase, throwDisposed } from "./core.ts";
import type { DisposableLike, Scope, ScopeOptions } from "./types.ts";
import { createIterableScope, drainEntries, type ScopeEntry } from "./utils.ts";

function unlinkArray(s: ScopeImpl, entry: ScopeEntry): void {
  const items = s.items_ as ScopeEntry[];
  items.splice(items.lastIndexOf(entry), 1);
}

function drainArray(s: ScopeImpl): unknown[] | undefined {
  const items = s.items_;
  s.items_ = null;
  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      detachChild(items[i]);
    }
    return drainEntries(items);
  }
}

class ScopeImpl extends ScopeBase implements Scope {
  items_: ScopeEntry[] | null = null;

  constructor(options?: ScopeOptions) {
    super(drainArray, options);
  }

  get [Symbol.toStringTag](): string {
    return "Scope";
  }

  get size(): number {
    return this.items_ ? this.items_.length : 0;
  }

  use<T extends DisposableLike | null | undefined>(value: T): T {
    if (this.disposed_) {
      throwDisposed(this);
    }
    if (value != null) {
      const entry: ScopeEntry = { v: value };
      (this.items_ ??= []).push(entry);
      attachChild(this, entry, unlinkArray);
    }
    return value;
  }

  adopt<T>(value: T, onDispose: (value: T) => void): T {
    if (this.disposed_) {
      throwDisposed(this);
    }
    (this.items_ ??= []).push({ v: value, f: onDispose });
    return value;
  }

  defer(onDispose: () => void): void {
    if (this.disposed_) {
      throwDisposed(this);
    }
    (this.items_ ??= []).push({ v: onDispose });
  }

  flush(): void {
    flushScope(this, drainArray);
  }

  move(): Scope {
    const next = new ScopeImpl();
    moveScope(this, next);
    const items = this.items_;
    if (items) {
      this.items_ = null;
      next.items_ = items;
      for (let i = 0; i < items.length; i++) {
        const entry = items[i];
        detachChild(entry);
        attachChild(next, entry, unlinkArray);
      }
    }
    return next;
  }
}

/**
 * Create an ordered (LIFO) disposal scope aligned with TC39 `DisposableStack`.
 */
export function scope(options?: ScopeOptions): Scope;
export function scope(items: Iterable<DisposableLike | null | undefined>, options?: ScopeOptions): Scope;
export function scope(
  itemsOrOptions?: Iterable<DisposableLike | null | undefined> | ScopeOptions,
  maybeOptions?: ScopeOptions,
): Scope {
  return createIterableScope(ScopeImpl, itemsOrOptions, maybeOptions);
}
