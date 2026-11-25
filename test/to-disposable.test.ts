import { describe, expect, it, vi } from "vitest";
import { formatTree } from "../src/debug/index.ts";
import { scope, scopeMap, scopeOne, scopeSet, toDisposable } from "../src/index.ts";
import { setDevMode } from "./setup.ts";

describe("toDisposable", () => {
  it("works standalone via call, .dispose(), and using, and is idempotent", () => {
    const fn = vi.fn();
    const d = toDisposable(fn);
    d();
    d();
    d.dispose();
    expect(fn).toHaveBeenCalledTimes(1);

    const fn2 = vi.fn();
    {
      using d2 = toDisposable(fn2);
      expect(typeof d2).toBe("function");
    }
    expect(fn2).toHaveBeenCalledTimes(1);

    setDevMode(false);
    const fn3 = vi.fn();
    const d3 = toDisposable(fn3);
    d3();
    expect(fn3).toHaveBeenCalledTimes(1);
    setDevMode(true);
  });

  it("auto-detaches from scope, scopeSet, scopeMap, and scopeOne on early disposal", () => {
    const s = scope();
    const d1 = s.use(toDisposable(vi.fn()));
    const d2 = s.use(toDisposable(vi.fn()));
    expect(s.size).toBe(2);
    d1();
    expect(s.size).toBe(1);
    s.dispose();
    expect(d2).toBeDefined();
    expect(s.size).toBe(0);

    const ss = scopeSet();
    const ds1 = ss.use(toDisposable(vi.fn()));
    const ds2 = ss.use(toDisposable(vi.fn()));
    expect(ss.size).toBe(2);
    ds1();
    expect(ss.size).toBe(1);
    expect(ss.has(ds1)).toBe(false);
    ss.dispose();
    expect(ss.has(ds2)).toBe(false);

    const sm = scopeMap<string>();
    const dm1 = sm.use("a", toDisposable(vi.fn()));
    sm.use("b", toDisposable(vi.fn()));
    expect(sm.size).toBe(2);
    dm1();
    expect(sm.size).toBe(1);
    expect(sm.has("a")).toBe(false);
    sm.dispose();

    const so = scopeOne();
    const do1 = so.use(toDisposable(vi.fn()));
    expect(so.size).toBe(1);
    do1();
    expect(so.size).toBe(0);
    expect(so.current).toBeUndefined();
    so.use(toDisposable(vi.fn()));
    so.dispose();
    expect(so.size).toBe(0);
  });

  it("supports multiple containing scopes and selective remove() unsubscription", () => {
    const fn = vi.fn();
    const d = toDisposable(fn);

    const s1 = scope();
    const s2 = scopeSet();
    const s3 = scopeMap<string>();

    s1.use(d);
    s2.use(d);
    s3.use("k", d);

    // Removing from s2 unsubscribes only s2
    expect(s2.remove(d)).toBe(true);
    expect(s2.size).toBe(0);

    // Disposing d detaches from remaining s1 and s3
    d();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(s1.size).toBe(0);
    expect(s3.size).toBe(0);

    s1.dispose();
    s2.dispose();
    s3.dispose();

    // 2-scope -> 1-scope -> 0-scope unsubscribe transitions
    const dMulti = toDisposable(vi.fn());
    const a = scopeSet();
    const b = scopeSet();
    const c = scopeSet();
    a.use(dMulti);
    b.use(dMulti);
    c.use(dMulti);
    b.remove(dMulti);
    c.remove(dMulti);
    a.remove(dMulti);
    dMulti();
    expect(a.size).toBe(0);
    a.dispose();
    b.dispose();
    c.dispose();
  });

  it("supports encapsulated classes with .dispose = toDisposable(...) and links dev tree", () => {
    class Logger {
      readonly #scope = scope({ name: "Logger" });
      readonly dispose = toDisposable(this.#scope.dispose);
    }

    const app = scope({ name: "App" });
    const logger = app.use(new Logger());

    expect(app.size).toBe(1);
    expect(formatTree(app)).toBe(["App (scope) [alive, size=1]", "└── Logger (scope) [alive, size=0]"].join("\n"));

    logger.dispose();
    expect(app.size).toBe(0);
    expect(formatTree(app)).toBe("App (scope) [alive, size=0]");
    app.dispose();
  });

  it("skips already-disposed managed disposers", () => {
    const dead = toDisposable(vi.fn());
    dead();

    const s = scope();
    const ss = scopeSet();
    const sm = scopeMap<string>();
    const so = scopeOne();

    expect(s.use(dead)).toBe(dead);
    expect(ss.use(dead)).toBe(dead);
    expect(sm.use("k", dead)).toBe(dead);
    expect(so.use(dead)).toBe(dead);
    expect(s.size).toBe(0);
    expect(ss.size).toBe(0);
    expect(sm.size).toBe(0);
    expect(so.size).toBe(0);
    s.dispose();
    ss.dispose();
    sm.dispose();
    so.dispose();
  });

  it("handles idempotent unsubscribe on the onDispose symbol protocol", () => {
    const sym = Symbol.for("@embra/detach");
    const d = toDisposable(vi.fn());
    const hook = (d as unknown as Record<symbol, (cb: () => void) => (() => void) | false>)[sym];
    const unsub1 = hook(vi.fn()) as () => void;
    const unsub2 = hook(vi.fn()) as () => void;
    unsub2();
    unsub2(); // idempotent splice when already removed
    unsub1();
    unsub1(); // idempotent splice when already empty
    d();

    const d2 = toDisposable(vi.fn());
    const hook2 = (d2 as unknown as Record<symbol, (cb: () => void) => (() => void) | false>)[sym];
    const u1 = hook2(vi.fn()) as () => void;
    u1(); // clears single listener
    u1(); // no-op when listeners is undefined
    hook2(vi.fn()); // listeners is now a different single function
    u1(); // no-op when listeners is another single function
    d2();
  });
});
