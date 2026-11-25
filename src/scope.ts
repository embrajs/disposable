import { assertAlive, flushScope, type OnDisposeHook, ScopeBase } from "./core.ts";
import { clearDevChildren, linkDevValue } from "./dev.ts";
import type { DisposableLike, Scope, ScopeOptions } from "./types.ts";
import { createIterableScope, drainEntries, type ScopeEntry, SYM_ON_DISPOSE } from "./utils.ts";

function drainArray(s: ScopeImpl): unknown[] | undefined {
  const items = s.items_;
  s.items_ = null;
  if (items) {
    if (__DEV__) {
      clearDevChildren(s);
    }
    return drainEntries(items.reverse());
  }
}

class ScopeImpl extends ScopeBase implements Scope {
  items_: ScopeEntry[] | null = null;

  constructor(options?: ScopeOptions) {
    super(drainArray, options, __DEV__ ? "scope" : undefined);
  }

  get size(): number {
    return this.items_?.length ?? 0;
  }

  use<T extends DisposableLike | null | undefined>(value: T): T {
    assertAlive(this);
    if (value != null) {
      const entry: ScopeEntry = { v: value };
      const hook = (value as { dispose?: Record<symbol, OnDisposeHook> }).dispose?.[SYM_ON_DISPOSE];
      if (
        hook &&
        !hook(() => {
          if (this.items_) {
            this.items_.splice(this.items_.lastIndexOf(entry), 1);
          }
        })
      ) {
        return value;
      }
      (this.items_ ??= []).push(entry);
      if (__DEV__) {
        linkDevValue(this, value);
      }
    }
    return value;
  }

  adopt<T>(value: T, onDispose: (value: T) => void): T {
    assertAlive(this);
    (this.items_ ??= []).push({ v: value, f: onDispose });
    return value;
  }

  flush(): void {
    flushScope(this, drainArray);
  }
}

/**
 * Create an ordered (LIFO) disposal scope.
 */
export function scope(options?: ScopeOptions): Scope;
export function scope(items: Iterable<DisposableLike | null | undefined>, options?: ScopeOptions): Scope;
export function scope(
  itemsOrOptions?: Iterable<DisposableLike | null | undefined> | ScopeOptions,
  maybeOptions?: ScopeOptions,
): Scope {
  return createIterableScope(ScopeImpl, itemsOrOptions, maybeOptions);
}
