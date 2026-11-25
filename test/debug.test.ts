import { describe, expect, it } from "vitest";
import { createLeakTracker, formatTree, inspect, trackLeaks } from "../src/debug/index.ts";
import { type BaseScope, scope, scopeMap, scopeOne, scopeSet } from "../src/index.ts";
import { setDevMode } from "./setup.ts";

describe("debug", () => {
  it("inspects scopes and formats deterministic plain-text trees", () => {
    const root = scope({ name: "App" });
    const modal = root.use(scopeSet({ name: "Modal" }));
    const timers = root.use(scopeMap<string>({ name: "Timers" }));
    const active = modal.use(scopeOne({ name: "Active" }));
    const unnamed = modal.use(scope());
    active.use(() => {});
    timers.use("t", () => {});

    const snap = inspect(root);
    expect(snap.name).toBe("App");
    expect(snap.kind).toBe("scope");
    expect(snap.disposed).toBe(false);
    expect(snap.size).toBe(2);
    expect(snap.createdAt).toBeDefined();
    expect(snap.disposedAt).toBeUndefined();
    expect(snap.children).toHaveLength(2);

    const tree = formatTree(root);
    expect(tree).toBe(
      [
        "App (scope) [alive, size=2]",
        "├── Modal (scopeSet) [alive, size=2]",
        "│   ├── Active (scopeOne) [alive, size=1]",
        "│   └── scope [alive, size=0]",
        "└── Timers (scopeMap) [alive, size=1]",
      ].join("\n"),
    );

    // Disposing a child unlinks it from the parent dev tree
    unnamed.dispose();
    expect(formatTree(modal)).toBe(
      ["Modal (scopeSet) [alive, size=2]", "└── Active (scopeOne) [alive, size=1]"].join("\n"),
    );

    // Disposing updates status and disposedAt
    root.dispose();
    const after = inspect(root);
    expect(after.disposed).toBe(true);
    expect(after.disposedAt).toBeDefined();
    expect(formatTree(root)).toBe("App (scope) [disposed, size=0]");
  });

  it("tracks encapsulated scopes via .dispose and detached dispose callbacks", () => {
    class Logger {
      readonly #scope = scope({ name: "Logger" });
      readonly dispose = this.#scope.dispose;
    }

    const root = scope({ name: "App" });
    const logger = root.use(new Logger());
    const detached = scope({ name: "Detached" });
    root.use(detached.dispose);

    // Non-scope disposables & already-disposed scopes are not linked as children
    const dead = scope({ name: "Dead" });
    dead.dispose();
    root.use(dead);
    root.use({ dispose() {} });
    root.use({ [Symbol.dispose]() {} });

    expect(formatTree(root)).toBe(
      [
        "App (scope) [alive, size=5]",
        "├── Logger (scope) [alive, size=0]",
        "└── Detached (scope) [alive, size=0]",
      ].join("\n"),
    );

    // Early disposal of child unlinks it from dev tree
    logger.dispose();
    expect(formatTree(root)).toBe(["App (scope) [alive, size=5]", "└── Detached (scope) [alive, size=0]"].join("\n"));

    root.dispose();
    expect(detached.disposed).toBe(true);
  });

  it("updates dev tree on remove(), prod-mode mutations, and prod-created scopes", () => {
    // remove() unlinks child scopes and handles adopted/non-scope entries
    const set = scopeSet({ name: "Set" });
    const setChild = set.use(scope({ name: "SetChild" }));
    const setFn = set.use(() => {});
    set.adopt("raw", () => {});
    set.remove(setChild);
    set.remove(setFn);
    set.remove("raw");
    expect(inspect(set).children).toHaveLength(0);
    setChild.dispose();
    set.dispose();

    const map = scopeMap<string>({ name: "Map" });
    const mapChild = map.use("k", scope({ name: "MapChild" }));
    expect(inspect(map).children).toHaveLength(1);
    map.remove("k");
    expect(inspect(map).children).toHaveLength(0);
    mapChild.dispose();
    map.dispose();

    const one = scopeOne({ name: "One" });
    const oneChild = one.use(scope({ name: "OneChild" }));
    expect(inspect(one).children).toHaveLength(1);
    one.remove();
    expect(inspect(one).children).toHaveLength(0);
    oneChild.dispose();
    one.dispose();

    // Prod-created scope mutated in dev mode has no dev meta
    setDevMode(false);
    const prodMap = scopeMap<string>();
    setDevMode(true);
    const prodChild = prodMap.use("c", scope());
    prodMap.remove("c");
    prodMap.use("d", () => {});
    prodChild.dispose();
    prodMap.dispose();

    // Prod-mode branches for scopeMap and scopeOne
    setDevMode(false);
    const pm = scopeMap<string>();
    pm.use("a", () => {});
    pm.remove("a");
    pm.use("b", () => {});
    pm.dispose();

    const po = scopeOne();
    po.use(() => {});
    po.remove();
    po.use(() => {});
    po.dispose();
    setDevMode(true);
  });

  it("handles cyclic child links safely during inspect", () => {
    const a = scope({ name: "A" });
    const b = scope({ name: "B" });
    a.use(b);
    b.use(a);
    const snap = inspect(a);
    expect(snap.children).toHaveLength(1);
    expect(snap.children[0].children).toHaveLength(0);
    a.dispose();
  });

  it("tracks leaked scopes with trackLeaks and createLeakTracker", () => {
    const clean = trackLeaks(() => {
      using s = scope({ name: "temp" });
      s.use(() => {});
      return 42;
    });
    expect(clean.result).toBe(42);
    expect(clean.leaks).toEqual([]);
    expect(clean.text).toBe("No leaked scopes.");

    let leaked1: BaseScope | undefined;
    let leaked2: BaseScope | undefined;
    const report = trackLeaks(() => {
      leaked1 = scope({ name: "LeakA" });
      leaked2 = scopeSet({ name: "LeakB" });
      return "done";
    });
    expect(report.result).toBe("done");
    expect(report.leaks).toHaveLength(2);
    expect(report.text).toContain("Leaked 2 scopes:");
    expect(report.text).toContain("LeakA (scope)");
    expect(report.text).toContain("LeakB (scopeSet)");
    leaked1?.dispose();
    leaked2?.dispose();

    // Single leak pluralization + createLeakTracker with using
    let single: BaseScope | undefined;
    {
      using tracker = createLeakTracker();
      single = scope({ name: "Single" });
      expect(tracker.leaks()).toHaveLength(1);
      expect(tracker.format()).toContain("Leaked 1 scope:");
      tracker.stop();
      tracker.stop(); // idempotent
    }
    single?.dispose();
  });

  it("degrades gracefully in production mode", () => {
    setDevMode(false);
    const s1 = scope();
    const s2 = scopeSet();
    const s3 = scopeMap();
    const s4 = scopeOne();
    const custom: BaseScope = {
      disposed: false,
      size: 0,
      signal: new AbortController().signal,
      dispose: () => {},
      [Symbol.dispose]() {},
      flush() {},
    };

    expect(inspect(s1).kind).toBe("unknown");
    expect(inspect(s2).kind).toBe("unknown");
    expect(inspect(s3).kind).toBe("unknown");
    expect(inspect(s4).kind).toBe("unknown");
    expect(inspect(custom).kind).toBe("unknown");
    expect(inspect(s1).createdAt).toBeUndefined();

    const report = trackLeaks(() => {
      const leaked = scope();
      return leaked;
    });
    expect(report.leaks).toEqual([]);
    expect(report.text).toBe("No leaked scopes.");

    s1.dispose();
    s2.dispose();
    s3.dispose();
    s4.dispose();
    report.result.dispose();
  });
});
