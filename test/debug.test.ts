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
    active.defer(() => {});
    timers.defer("t", () => {});

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

    // Moving a scope records moved status
    const moved = unnamed.move();
    expect(formatTree(unnamed)).toBe("scope [moved, size=0]");
    moved.dispose();

    // Disposing updates status and disposedAt
    root.dispose();
    const after = inspect(root);
    expect(after.disposed).toBe(true);
    expect(after.disposedReason).toBe("disposed");
    expect(after.disposedAt).toBeDefined();
    expect(formatTree(root)).toBe("App (scope) [disposed, size=0]");
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
      s.defer(() => {});
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

    expect(inspect(s1).kind).toBe("scope");
    expect(inspect(s2).kind).toBe("scopeSet");
    expect(inspect(s3).kind).toBe("scopeMap");
    expect(inspect(s4).kind).toBe("scopeOne");
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
