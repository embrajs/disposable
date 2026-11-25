import { describe, expect, it, vi } from "vitest";
import { scope, scopeMap } from "../src/index.ts";

describe("scopeMap", () => {
  it("replaces and flushes previous resource on same key", () => {
    const order: string[] = [];
    const sm = scopeMap<string>({ name: "timers" });
    expect(Object.prototype.toString.call(sm)).toBe("[object ScopeMap]");
    expect(sm.size).toBe(0);
    expect(sm.signal.aborted).toBe(false);
    expect([...sm.keys()]).toEqual([]);

    const d1 = () => order.push("d1");
    const d2 = () => order.push("d2");

    expect(sm.use("a", d1)).toBe(d1);
    // Setting same reference is a no-op
    expect(sm.use("a", d1)).toBe(d1);
    expect(order).toEqual([]);

    // Replacing flushes d1
    sm.use("a", d2);
    expect(order).toEqual(["d1"]);
    expect(sm.get("a")).toBe(d2);
    expect(sm.has("a")).toBe(true);

    // Passing null/undefined flushes key
    expect(sm.use("a", null)).toBeNull();
    expect(order).toEqual(["d1", "d2"]);
    expect(sm.has("a")).toBe(false);

    // adopt & defer
    const val = sm.adopt("b", 100, (n) => order.push(`adopt:${n}`));
    expect(val).toBe(100);
    sm.defer("c", () => order.push("defer:c"));
    expect([...sm.keys()]).toEqual(["b", "c"]);
    expect(sm.size).toBe(2);

    sm.dispose();
    expect(sm.disposed).toBe(true);
    expect(sm.signal.aborted).toBe(true);
    expect(sm.size).toBe(0);
    expect(order).toEqual(["d1", "d2", "defer:c", "adopt:100"]);

    {
      using m = scopeMap<string>();
      m.defer("u", () => order.push("using"));
    }
    expect(order).toEqual(["d1", "d2", "defer:c", "adopt:100", "using"]);
  });

  it("supports remove(), targeted flush(key), and flush()", () => {
    const sm = scopeMap<string>();
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    expect(sm.remove("missing")).toBeUndefined();

    sm.use("k1", fn1);
    sm.use("k2", fn2);

    expect(sm.remove("k1")).toBe(fn1);
    expect(fn1).not.toHaveBeenCalled();
    expect(sm.has("k1")).toBe(false);

    sm.flush("k2");
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(sm.size).toBe(0);

    // flush missing key & empty map
    sm.flush("missing");
    sm.flush();

    const fn3 = vi.fn();
    sm.use("k3", fn3);
    sm.flush();
    expect(fn3).toHaveBeenCalledTimes(1);

    sm.dispose();
    sm.flush();
  });

  it("auto-detaches child scopes and supports move()", () => {
    const sm1 = scopeMap<string>();
    const child = sm1.use("c", scope());
    const fn = vi.fn();
    sm1.use("f", fn);

    const sm2 = sm1.move();
    expect(sm1.disposed).toBe(true);
    expect(sm2.size).toBe(2);

    child.dispose();
    expect(sm2.has("c")).toBe(false);
    expect(sm2.size).toBe(1);

    // Guard against stale child detach when key was overwritten
    const c1 = sm2.use("x", scope());
    const c2 = sm2.use("x", scope());
    expect(c1.disposed).toBe(true);
    expect(sm2.get("x")).toBe(c2);

    sm2.dispose();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c2.disposed).toBe(true);

    // move empty
    const empty1 = scopeMap();
    const empty2 = empty1.move();
    expect(empty1.disposed).toBe(true);
    expect(empty2.size).toBe(0);
    empty2.dispose();
  });

  it("cleans up and throws ReferenceError after dispose", () => {
    const sm = scopeMap<string>();
    sm.dispose();

    const fn = vi.fn();
    expect(() => sm.use("a", fn)).toThrow(ReferenceError);
    expect(fn).toHaveBeenCalledTimes(1);

    expect(() => sm.use("a", null)).toThrow(ReferenceError);

    const clean = vi.fn();
    expect(() => sm.adopt("a", 1, clean)).toThrow(ReferenceError);
    expect(clean).toHaveBeenCalledWith(1);

    const def = vi.fn();
    expect(() => sm.defer("a", def)).toThrow(ReferenceError);
    expect(def).toHaveBeenCalledTimes(1);
  });
});
