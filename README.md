# @embra/disposable

[![Docs](https://img.shields.io/badge/Docs-read-%23fdf9f5)](https://embrajs.github.io/disposable)
[![Build Status](https://github.com/embrajs/disposable/actions/workflows/build.yml/badge.svg)](https://github.com/embrajs/disposable/actions/workflows/build.yml)
[![npm-version](https://img.shields.io/npm/v/@embra/disposable.svg)](https://www.npmjs.com/package/@embra/disposable)
[![Coverage Status](https://embrajs.github.io/disposable/coverage-badges/@embra/disposable.svg)](https://embrajs.github.io/disposable/coverage/)

Explicit disposal scopes for predictable resource cleanup, built for AI agents.

## Features

- **Works with any cleanup style**: Manage cleanup functions (`() => void`), `{ dispose() }`, TC39 `Disposable` (`using`), and raw resources (`adopt()`) through one API.
- **Scope primitives for every pattern**: Ordered stacks (`scope`), deduplicated sets (`scopeSet`), keyed maps that dispose replaced entries (`scopeMap`), and single replaceable slots (`scopeOne`).
- **Composable lifecycles**: Nest child scopes with automatic early-dispose detachment, and pass `scope.signal` directly to `AbortSignal`-aware APIs.
- **AI-agent observability**: `@embra/disposable/debug` provides snapshots (`inspect`), deterministic plain-text scope trees (`formatTree`), and leak detection (`trackLeaks` / `createLeakTracker`), with zero production overhead.
- **Small & tree-shakeable**: Compact pure ESM where each scope tree-shakes independently.

![export size](https://embrajs.github.io/disposable/assets/export-size.svg)

## Install

```sh
npm add @embra/disposable
```

| Entry Point               | Purpose                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `@embra/disposable`       | Core scopes (`scope`, `scopeSet`, `scopeMap`, `scopeOne`) and helpers (`dispose`, `isDisposable`)     |
| `@embra/disposable/debug` | Scope tree inspection (`inspect`, `formatTree`) and leak tracking (`trackLeaks`, `createLeakTracker`) |

### For AI Agents

- Install the Agent Skill:

  ```sh
  npx skills add embrajs/disposable
  ```

- Or use the plain-text reference [llms.txt](https://embrajs.github.io/disposable/llms.txt) (also bundled at `node_modules/@embra/disposable/llms.txt`).


## Quick Start

Collect disposers, disposables, and raw resources in a scope, then dispose them all together:

```ts
import { scope } from "@embra/disposable";

// Example helper that returns a cleanup function
const listen = (target: EventTarget, type: string, listener: EventListener) => {
  target.addEventListener(type, listener);
  return () => target.removeEventListener(type, listener);
};

class Logger {
  readonly #scope = scope();
  readonly dispose = this.#scope.dispose;

  constructor(target: EventTarget) {
    this.#scope.use(listen(target, "click", () => console.log("clicked")));
    this.#scope.adopt(
      setInterval(() => console.log("heartbeat"), 5000),
      clearInterval,
    );
  }
}

class App {
  readonly #scope = scope();
  readonly dispose = this.#scope.dispose;
  // Logger has a `.dispose` method, so it composes directly into App's scope
  readonly logger = this.#scope.use(new Logger(window));
}

const app = new App();
app.dispose(); // cleans up both App and Logger in LIFO order
```

`scope.dispose` is pre-bound, so you can also return it directly from callbacks like React `useEffect`:

```ts
useEffect(() => {
  const s = scope();
  s.use(listen(window, "resize", onResize));
  s.adopt(setInterval(poll, 5000), clearInterval);
  return s.dispose;
}, []);
```

## Core Primitives

All four scopes accept cleanup functions `() => void`, `{ dispose(): void }`, and `{ [Symbol.dispose](): void }`, and expose `disposed`, `size`, `signal`, pre-bound `dispose`, `[Symbol.dispose]`, `flush()`, and `move()`.

### `scope(items?, options?)`

Ordered LIFO stack for general module, class, or effect lifecycles:

```ts
import { scope } from "@embra/disposable";

const s = scope([listen(window, "resize", onResize), listen(window, "scroll", onScroll)]);

const ws = s.adopt(new WebSocket("wss://example.com"), (w) => w.close());
s.defer(() => console.log("cleaned up", ws.url));

s.dispose();
```

### `scopeSet(items?, options?)`

Deduplicated set keyed by resource reference. Useful for dynamic registries or listener collections where individual items may be added and removed over time:

```ts
import { scopeSet } from "@embra/disposable";

const sockets = scopeSet();

function trackSocket(ws: WebSocket) {
  const close = sockets.use(() => ws.close());
  ws.addEventListener("close", () => sockets.remove(close), { once: true });
  return () => sockets.flush(close); // close and remove this socket early
}

// Close all remaining open sockets on shutdown
sockets.dispose();
```

### `scopeMap<K>(options?)`

Keyed refreshable map. Setting an existing key disposes its previous entry first, making it useful for debouncing or per-ID subscriptions:

```ts
import { scopeMap } from "@embra/disposable";

const timers = scopeMap<string>({ name: "autosave" });

function onFieldChange(field: string, value: string) {
  // Cancels any pending timeout for this field before scheduling a new one
  timers.adopt(
    field,
    setTimeout(() => saveField(field, value), 300),
    clearTimeout,
  );
}

timers.flush("title"); // cancel a single key
timers.dispose(); // cancel all pending timers
```

### `scopeOne<T>(initial?, options?)`

Single-slot refreshable scope. Setting a new resource disposes the previous one first, ideal for tracking a single active connection, timer, or subscription:

```ts
import { scopeOne } from "@embra/disposable";

const activeRoom = scopeOne<WebSocket>();

function joinRoom(roomId: string) {
  // Closes the previous room connection before opening the new one
  activeRoom.adopt(new WebSocket(`wss://example.com/rooms/${roomId}`), (ws) => ws.close());
}

joinRoom("general");
joinRoom("random"); // automatically closes "general"
activeRoom.dispose(); // closes "random"
```

## Nested Scopes & `AbortSignal`

Nesting a child scope with `parent.use(child)` links their lifecycles: disposing the parent cleans up all children, while disposing a child early automatically detaches it from the parent. Every scope also exposes a `signal` that aborts on `dispose()`:

```ts
import { scope } from "@embra/disposable";

const app = scope({ name: "App" });
const request = app.use(scope({ name: "FetchUser" }));

fetch("/api/user", { signal: request.signal });

// Disposing the child early aborts the fetch and detaches it from `app`
request.dispose();
app.size; // 0
```

## TC39 `using` & Ownership Transfer

All scopes implement `[Symbol.dispose]` (and `scope` is compatible with TC39 `DisposableStack`), so they work with `using` blocks. In factories or constructors, combine `using` with `move()` to clean up partial resources if initialization throws and transfer ownership on success:

```ts
import { scope } from "@embra/disposable";

function createClient(url: string) {
  using init = scope({ name: "client" });

  const ws = init.adopt(new WebSocket(url), (w) => w.close());
  // If authentication throws, `ws` is closed automatically when leaving the block
  init.use(authenticate(ws));

  // Transfer ownership (including any active `signal`); `init` becomes disposed so `using` is a no-op
  const owned = init.move();
  return {
    ws,
    dispose: owned.dispose,
    [Symbol.dispose]: owned.dispose,
  };
}
```

## Utilities (`dispose` / `isDisposable`)

```ts
import { dispose, isDisposable } from "@embra/disposable";

if (isDisposable(resource)) {
  dispose(resource);
}
```

## Debugging (`@embra/disposable/debug`)

`@embra/disposable/debug` emits structured snapshots, deterministic plain-text scope trees, and leak reports designed for test suites and AI agent diagnostics, with zero production overhead:

```ts
import { scope, scopeMap } from "@embra/disposable";
import { createLeakTracker, formatTree, inspect, trackLeaks } from "@embra/disposable/debug";

const app = scope({ name: "App" });
const timers = app.use(scopeMap({ name: "Timers" }));
timers.defer("poll", () => {});

console.log(inspect(app));
console.log(formatTree(app));
// App (scope) [alive, size=1]
// └── Timers (scopeMap) [alive, size=1]

// Detect undisposed scopes created during an action
const report = trackLeaks(() => {
  const leaked = scope({ name: "Forgotten" });
  return leaked;
});
console.log(report.text);
// Leaked 1 scope:
// - Forgotten (scope) [alive, size=0]
//     at ...

report.result.dispose();
app.dispose();
```

For async workflows or `beforeEach` / `afterEach` hooks, use `createLeakTracker()` (which also implements `Disposable`).

## Design Contracts

- **One-shot `dispose()` vs. `flush()`**: `dispose()` is irreversible and idempotent. Calling `use`, `adopt`, `defer`, or `move` after disposal throws `ReferenceError` (with the original disposal stack trace in development builds). Use `flush()` to clear entries while keeping the scope active.
- **LIFO order & error propagation**: Remaining resources still dispose if one throws. A single error is rethrown directly; multiple errors throw an `AggregateError`.
- **Explicit ownership**: Keep scopes private (`#scope` or a closure) and expose only `dispose` / `[Symbol.dispose]`. `scope.dispose` is pre-bound and safe to pass directly to callbacks such as React `useEffect`.

## Documentation

Full API documentation is available at [embrajs.github.io/disposable](https://embrajs.github.io/disposable).

## License

MIT @ [embrajs](https://github.com/embrajs)
