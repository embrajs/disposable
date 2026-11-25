import { describe, expect, it, vi } from "vitest";
import { scope, scopeMap } from "../src/index.ts";

describe("scopeMap", () => {
  it("replaces and flushes previous resource on same key", () => {
    const order: string[] = [];
    const sm = scopeMap<string>({ name: "timers" });
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

    // adopt
    const val = sm.adopt("b", 100, (n) => order.push(`adopt:${n}`));
    expect(val).toBe(100);
    expect([...sm.keys()]).toEqual(["b"]);
    expect(sm.size).toBe(1);

    sm.dispose();
    expect(sm.disposed).toBe(true);
    expect(sm.signal.aborted).toBe(true);
    expect(sm.size).toBe(0);
    expect(order).toEqual(["d1", "d2", "adopt:100"]);

    {
      using m = scopeMap<string>();
      m.use("u", () => order.push("using"));
    }
    expect(order).toEqual(["d1", "d2", "adopt:100", "using"]);
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

  it("treats flush(undefined) as a targeted key flush, not a full flush", () => {
    const sm = scopeMap<string | undefined>();
    const fnOther = vi.fn();
    const fnUndef = vi.fn();

    sm.use("k1", fnOther);

    // Calling flush(undefined) when undefined is not a key is a no-op
    sm.flush(undefined);
    expect(fnOther).not.toHaveBeenCalled();
    expect(sm.size).toBe(1);

    // Calling flush(undefined) when undefined is stored flushes only undefined
    sm.use(undefined, fnUndef);
    expect(sm.size).toBe(2);
    sm.flush(undefined);
    expect(fnUndef).toHaveBeenCalledTimes(1);
    expect(fnOther).not.toHaveBeenCalled();
    expect(sm.has(undefined)).toBe(false);
    expect(sm.has("k1")).toBe(true);

    // Calling flush() with no arguments flushes all remaining entries
    sm.flush();
    expect(fnOther).toHaveBeenCalledTimes(1);
    expect(sm.size).toBe(0);
  });

  it("cascades to child scopes and disposes overwritten keys", () => {
    const sm = scopeMap<string>();
    const child = sm.use("c", scope());
    const fn = vi.fn();
    sm.use("f", fn);

    child.dispose();
    expect(child.disposed).toBe(true);

    // Overwriting key disposes previous child
    const c1 = sm.use("x", scope());
    const c2 = sm.use("x", scope());
    expect(c1.disposed).toBe(true);
    expect(sm.get("x")).toBe(c2);

    sm.dispose();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c2.disposed).toBe(true);
  });

  it("throws ReferenceError after dispose", () => {
    const sm = scopeMap<string>();
    sm.dispose();

    const fn = vi.fn();
    expect(() => sm.use("a", fn)).toThrow(ReferenceError);
    expect(fn).not.toHaveBeenCalled();

    expect(() => sm.use("a", null)).toThrow(ReferenceError);

    const clean = vi.fn();
    expect(() => sm.adopt("a", 1, clean)).toThrow(ReferenceError);
    expect(clean).not.toHaveBeenCalled();
  });
});
