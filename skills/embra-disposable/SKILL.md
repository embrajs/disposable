---

name: embra-disposable
description: Explicit resource cleanup scopes, AbortSignal lifecycles, and leak detection with @embra/disposable. Use when managing timers, listeners, subscriptions, nested lifecycles, or debugging resource leaks.
---

# @embra/disposable

For exact TypeScript signatures and JSDoc, read `node_modules/@embra/disposable/dist/{index,debug}.d.mts`.

**Not provided** (do not invent): no `AsyncDisposableStack` / `asyncScope`, no callable scopes (scopes are objects with a pre-bound `.dispose` method).

## 1. Choosing the Right Scope

All four scopes accept `() => void`, `{ dispose(): void }`, and `{ [Symbol.dispose](): void }`, and expose `use`, `adopt`, `defer`, `flush`, `move`, `dispose`, `[Symbol.dispose]`, `disposed`, `size`, and `signal`.

| Primitive                      | Use When                                                     | Key Behavior                                                                        |
| ------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `scope(items?, opts?)`         | Default ordered LIFO stack for modules, classes, or effects  | Compatible with TC39 `DisposableStack`. No `has`/`remove`.                          |
| `scopeSet(items?, opts?)`      | Dynamic collections needing deduplication or removal by ref  | Deduplicated by reference; supports `has(v)`, `remove(v)`, `flush(v?)`.             |
| `scopeMap<K>(opts?)`           | Keyed refreshable resources (debounce, per-ID subscriptions) | Replacing a key disposes the old entry first; `use(key, null)` flushes `key`.       |
| `scopeOne<T>(initial?, opts?)` | Single active slot (current connection, active timer)        | Setting a new entry disposes the previous one first; `current`, `is()`, `remove()`. |

```ts
import { scope, scopeMap, scopeOne, scopeSet } from "@embra/disposable";

// Ordered stack
const s = scope([listen(window, "resize", onResize)]);
const ws = s.adopt(new WebSocket("wss://example.com"), (w) => w.close());
s.defer(() => console.log("closed", ws.url));
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
- Nesting via `parent.use(child)` cascades parent disposal to children and automatically detaches `child` from `parent` if `child.dispose()` runs early.
- `s.signal` creates an `AbortController` on first access, aborts on `dispose()`, transfers on `move()`, and returns an aborted signal if accessed after disposal.

```ts
import { scope } from "@embra/disposable";

class App {
  readonly #scope = scope({ name: "App" });
  readonly dispose = this.#scope.dispose;

  fetchUser() {
    const req = this.#scope.use(scope({ name: "FetchUser" }));
    fetch("/api/user", { signal: req.signal });
    return req.dispose; // aborts fetch and detaches `req` from `#scope`
  }
}
```

## 3. `using` & Ownership Transfer (`move()`)

All scopes implement `[Symbol.dispose]`. In factories/constructors, pair `using` with `move()` so partial initialization errors clean up automatically while success transfers ownership (including any active `signal`):

```ts
import { scope } from "@embra/disposable";

function createClient(url: string) {
  using init = scope({ name: "client" });
  const ws = init.adopt(new WebSocket(url), (w) => w.close());
  init.use(authenticate(ws)); // throws -> `ws` closes automatically

  const owned = init.move(); // `init.disposed === true`, so `using` is a no-op
  return { ws, dispose: owned.dispose, [Symbol.dispose]: owned.dispose };
}
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
  s.defer(() => {});
});
// report.leaks === [], report.text === "No leaked scopes."

// Async / hook leak tracker
using tracker = createLeakTracker();
console.log(tracker.format());
```

## 5. Design Contracts

- **One-shot `dispose()` vs. `flush()`**: `dispose()` is irreversible and idempotent. Calling `use`, `adopt`, `defer`, or `move` on a disposed/moved scope throws `ReferenceError` (with the original disposal stack trace in dev). Use `flush()` to clear and reuse a scope.
- **LIFO & error propagation**: Remaining resources still dispose if one throws; a single error rethrows directly and multiple errors throw `AggregateError`.
- **`flush()` vs. `flush(key)`**: Only calling `flush()` with no arguments clears all entries; `scopeMap.flush(undefined)` and `scopeSet.flush(undefined)` target `undefined` without clearing other entries.
- **`adopt()` does not auto-detach children**: Parent-child auto-detach only applies to `parent.use(child)`.
