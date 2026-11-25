import { attachChild, detachChild, flushScope, guardDisposed, moveScope, ScopeBase } from "./core.ts";
import type { DisposableLike, Scope, ScopeOptions } from "./types.ts";
import { createIterableScope, drainEntries, type ScopeEntry } from "./utils.ts";

function pushEntry(s: ScopeImpl, entry: ScopeEntry): void {
  const items = (s.items_ ??= []);
  items.push(entry);
  attachChild(s, entry, () => {
    items.splice(items.lastIndexOf(entry), 1);
  });
}

function drainArray(s: ScopeImpl): unknown[] | undefined {
  const items = s.items_;
  if (!items || items.length === 0) {
    s.items_ = undefined;
    return undefined;
  }
  s.items_ = undefined;
  for (const entry of items) {
    detachChild(entry);
  }
  return drainEntries(items);
}

class ScopeImpl extends ScopeBase implements Scope {
  items_?: ScopeEntry[];

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
    guardDisposed(this, value);
    if (value != null) {
      pushEntry(this, { v: value });
    }
    return value;
  }

  adopt<T>(value: T, onDispose: (value: T) => void): T {
    guardDisposed(this, value, onDispose);
    pushEntry(this, { v: value, f: onDispose });
    return value;
  }

  defer(onDispose: () => void): void {
    guardDisposed(this, onDispose);
    pushEntry(this, { v: onDispose });
  }

  flush(): void {
    flushScope(this, drainArray);
  }

  move(): Scope {
    const next = new ScopeImpl();
    moveScope(this, next);
    const items = this.items_;
    if (items) {
      this.items_ = undefined;
      for (const entry of items) {
        detachChild(entry);
        pushEntry(next, entry);
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
