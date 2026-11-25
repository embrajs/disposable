# @embra/disposable

[![Docs](https://img.shields.io/badge/Docs-read-%23fdf9f5)](https://embrajs.github.io/disposable)
[![Build Status](https://github.com/embrajs/disposable/actions/workflows/build.yml/badge.svg)](https://github.com/embrajs/disposable/actions/workflows/build.yml)
[![npm-version](https://img.shields.io/npm/v/@embra/disposable.svg)](https://www.npmjs.com/package/@embra/disposable)
[![Coverage Status](https://embrajs.github.io/disposable/coverage-badges/@embra/disposable.svg)](https://embrajs.github.io/disposable/coverage/)

Explicit disposal scopes for predictable resource cleanup, built for AI agents.

## Features

- **Works with any cleanup style**: Manage cleanup functions (`() => void`), `{ dispose() }`, TC39 `Disposable` (`using`), and raw resources (`adopt()`) through one API.
- **Scope primitives for every pattern**: Ordered stacks (`scope`), deduplicated sets (`scopeSet`), keyed maps that dispose replaced entries (`scopeMap`), and single replaceable slots (`scopeOne`).
- **Composable lifecycles**: Nest child scopes (including encapsulated classes exposing `.dispose`) with cascading disposal, and pass `scope.signal` directly to `AbortSignal`-aware APIs.
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

All four scopes accept cleanup functions `() => void`, `{ dispose(): void }`, and `{ [Symbol.dispose](): void }`, and expose `disposed`, `size`, `signal`, pre-bound `dispose`, `[Symbol.dispose]`, and `flush()`.

### `scope(items?, options?)`

Ordered LIFO stack for general module, class, or effect lifecycles:

```ts
import { scope } from "@embra/disposable";

const s = scope([listen(window, "resize", onResize), listen(window, "scroll", onScroll)]);

const ws = s.adopt(new WebSocket("wss://example.com"), (w) => w.close());
s.use(() => console.log("cleaned up", ws.url));

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

Nesting a child scope (or any object/class exposing `.dispose`) with `parent.use(child)` cascades disposal from parent to children. Every scope also exposes a lazy `signal` that aborts on `dispose()`. For dynamic collections where individual items are added and removed over time, use `scopeSet`, `scopeMap`, or `scopeOne`:

```ts
import { scope } from "@embra/disposable";

const app = scope({ name: "App" });
const request = app.use(scope({ name: "FetchUser" }));

fetch("/api/user", { signal: request.signal });

// Disposing the parent aborts and disposes all nested children
app.dispose();
request.disposed; // true
request.signal.aborted; // true
```

## TC39 `using`

All scopes implement `[Symbol.dispose]`, so they work directly with `using` blocks:

```ts
import { scope } from "@embra/disposable";

{
  using s = scope({ name: "request" });
  const ws = s.adopt(new WebSocket("wss://example.com"), (w) => w.close());
  s.use(() => console.log("closed", ws.url));
} // `s` is automatically disposed when leaving the block
```

## Utilities (`dispose` / `isDisposable` / `toDisposable` / `timeout` / `interval`)

```ts
import { dispose, interval, isDisposable, scope, timeout, toDisposable } from "@embra/disposable";

if (isDisposable(resource)) {
  dispose(resource);
}

// Wrap a cleanup function so calling it early automatically detaches it from containing scopes
const stop = toDisposable(() => console.log("cleaned up"));

const s = scope();
// One-shot timeout auto-detaches from `s` when it fires; both timers cancel on `s.dispose()`
s.use(timeout(() => console.log("once"), 1000));
s.use(interval(() => console.log("tick"), 500));
s.use(stop);
```

## Debugging (`@embra/disposable/debug`)

`@embra/disposable/debug` emits structured snapshots, deterministic plain-text scope trees, and leak reports designed for test suites and AI agent diagnostics, with zero production overhead:

```ts
import { scope, scopeMap } from "@embra/disposable";
import { createLeakTracker, formatTree, inspect, trackLeaks } from "@embra/disposable/debug";

const app = scope({ name: "App" });
const timers = app.use(scopeMap({ name: "Timers" }));
timers.use("poll", () => {});

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

- **One-shot `dispose()` vs. `flush()`**: `dispose()` is irreversible and idempotent. Calling `use` or `adopt` after disposal throws `ReferenceError` (with the original disposal stack trace in development builds). Use `flush()` to clear entries while keeping the scope active.
- **Disposal order & error propagation**: `scope` disposes in LIFO order (`scopeSet` and `scopeMap` dispose in insertion order). Remaining resources still dispose if one throws. A single error is rethrown directly; multiple errors throw an `AggregateError`.
- **Explicit ownership**: Keep scopes private (`#scope` or a closure) and expose only `dispose` / `[Symbol.dispose]`. `scope.dispose` is pre-bound and safe to pass directly to callbacks such as React `useEffect`.

## Documentation

Full API documentation is available at [embrajs.github.io/disposable](https://embrajs.github.io/disposable).

## License

MIT @ [embrajs](https://github.com/embrajs)
