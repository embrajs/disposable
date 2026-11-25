---

name: embra-disposable
description: Explicit resource cleanup scopes, AbortSignal lifecycles, and leak detection with @embra/disposable. Use when managing timers, listeners, subscriptions, nested lifecycles, or debugging resource leaks.
---

# @embra/disposable

For exact TypeScript signatures and JSDoc, read `node_modules/@embra/disposable/dist/{index,debug}.d.mts`.

**Not provided** (do not invent): no `AsyncDisposableStack` / `asyncScope`, no callable scopes (scopes are objects with a pre-bound `.dispose` method).

## 1. Choosing the Right Scope

All four scopes accept `() => void`, `{ dispose(): void }`, and `{ [Symbol.dispose](): void }`, and expose `use`, `adopt`, `flush`, `dispose`, `[Symbol.dispose]`, `disposed`, `size`, and `signal`.

| Primitive                      | Use When                                                     | Key Behavior                                                                        |
| ------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `scope(items?, opts?)`         | Default ordered LIFO stack for modules, classes, or effects  | Ordered LIFO disposal. No `has`/`remove`.                                           |
| `scopeSet(items?, opts?)`      | Dynamic collections needing deduplication or removal by ref  | Deduplicated by reference; supports `has(v)`, `remove(v)`, `flush(v?)`.             |
| `scopeMap<K>(opts?)`           | Keyed refreshable resources (debounce, per-ID subscriptions) | Replacing a key disposes the old entry first; `use(key, null)` flushes `key`.       |
| `scopeOne<T>(initial?, opts?)` | Single active slot (current connection, active timer)        | Setting a new entry disposes the previous one first; `current`, `is()`, `remove()`. |

```ts
import { scope, scopeMap, scopeOne, scopeSet } from "@embra/disposable";

// Ordered stack
const s = scope([listen(window, "resize", onResize)]);
const ws = s.adopt(new WebSocket("wss://example.com"), (w) => w.close());
s.use(() => console.log("closed", ws.url));
s.dispose();

// Deduplicated set (remove or flush individual items)
const sockets = scopeSet();
const close = sockets.use(() => ws.close());
sockets.flush(close);

// Keyed refreshable map (debounce per key)
const timers = scopeMap<string>();
timers.adopt("title", setTimeout(save, 300), clearTimeout);

// Single replaceable slot (closes previous room before opening next)
const activeRoom = scopeOne<WebSocket>();
activeRoom.adopt(new WebSocket("wss://example.com/rooms/general"), (w) => w.close());
```

## 2. Ownership, Nesting & `AbortSignal`

- Keep scopes private (`#scope` or closure) and expose only `dispose` / `[Symbol.dispose]`.
- `s.dispose` is pre-bound (`(this: void) => void`) and safe to pass detached (e.g. `return s.dispose` in React `useEffect` or `@embra/reactivity` `watch`).
- `use(null)` / `use(undefined)` is a no-op on `scope`/`scopeSet`, and flushes the key/slot on `scopeMap`/`scopeOne`.
- Nesting via `parent.use(child)` (or `parent.use(child.dispose)`) cascades parent disposal to children, and links them in `@embra/disposable/debug` trees even when the child scope is encapsulated behind a `.dispose` property. Use `toDisposable(fn)` when a self-completing resource or encapsulated class (`readonly dispose = toDisposable(this.#scope.dispose)`) should automatically detach from its containing scopes when disposed early. Use `timeout(fn, ms?)` / `interval(fn, ms?)` for managed timers that auto-detach when triggered or cancelled early. Use `scopeSet`, `scopeMap`, or `scopeOne` when entries need to be removed or replaced dynamically.
- `s.signal` creates an `AbortController` on first access, aborts on `dispose()`, and returns an aborted signal if accessed after disposal.

```ts
import { scope } from "@embra/disposable";

class App {
  readonly #scope = scope({ name: "App" });
  readonly dispose = this.#scope.dispose;

  fetchUser() {
    const req = this.#scope.use(scope({ name: "FetchUser" }));
    fetch("/api/user", { signal: req.signal });
    return req.dispose;
  }
}
```

## 3. `using`, `toDisposable()` & Timers

All scopes, `toDisposable()`, `timeout()`, and `interval()` implement `[Symbol.dispose]`:

```ts
import { interval, scope, timeout, toDisposable } from "@embra/disposable";

using s = scope({ name: "App" });
s.use(timeout(() => console.log("once"), 1000)); // auto-detaches after firing
s.use(interval(() => console.log("tick"), 500));

const custom = s.use(toDisposable(() => console.log("custom cleanup")));
custom(); // runs cleanup and detaches from `s`
```

## 4. Debugging & Leak Detection (`@embra/disposable/debug`)

- Designed for tests and AI agent diagnostics with zero production overhead (`trackLeaks` / `createLeakTracker` degrade to no-ops in production).
- Pass `{ name }` on scopes for readable trees and disposal stack traces in development.

```ts
import { scope, scopeMap } from "@embra/disposable";
import { createLeakTracker, formatTree, inspect, trackLeaks } from "@embra/disposable/debug";

const app = scope({ name: "App" });
app.use(scopeMap({ name: "Timers" }));
console.log(inspect(app), formatTree(app));

// Sync leak assertion
const report = trackLeaks(() => {
  using s = scope({ name: "Temp" });
  s.use(() => {});
});
// report.leaks === [], report.text === "No leaked scopes."

// Async / hook leak tracker
using tracker = createLeakTracker();
console.log(tracker.format());
```

## 5. Design Contracts

- **One-shot `dispose()` vs. `flush()`**: `dispose()` is irreversible and idempotent. Calling `use` or `adopt` on a disposed scope throws `ReferenceError` (with the original disposal stack trace in dev). Use `flush()` to clear and reuse a scope.
- **Disposal order & error propagation**: `scope` disposes in LIFO order (`scopeSet` and `scopeMap` dispose in insertion order). Remaining resources still dispose if one throws; a single error rethrows directly and multiple errors throw `AggregateError`.
- **`flush()` vs. `flush(key)`**: Only calling `flush()` with no arguments clears all entries; `scopeMap.flush(undefined)` and `scopeSet.flush(undefined)` target `undefined` without clearing other entries.
