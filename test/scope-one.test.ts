import { describe, expect, it, vi } from "vitest";
import { scope, scopeOne } from "../src/index.ts";

describe("scopeOne", () => {
  it("manages a single refreshable slot across use, adopt, and defer", () => {
    const order: string[] = [];
    const so = scopeOne({ name: "slot" });
    expect(Object.prototype.toString.call(so)).toBe("[object ScopeOne]");
    expect(so.size).toBe(0);
    expect(so.signal.aborted).toBe(false);
    expect(so.current).toBeUndefined();

    const d1 = () => order.push("d1");
    const d2 = () => order.push("d2");

    expect(so.use(d1)).toBe(d1);
    expect(so.size).toBe(1);
    expect(so.current).toBe(d1);
    expect(so.is(d1)).toBe(true);
    expect(so.is(d2)).toBe(false);

    // Same reference is a no-op
    so.use(d1);
    expect(order).toEqual([]);

    // Replacing disposes d1
    so.use(d2);
    expect(order).toEqual(["d1"]);

    // Null clears slot
    expect(so.use(null)).toBeNull();
    expect(order).toEqual(["d1", "d2"]);
    expect(so.size).toBe(0);
    expect(so.current).toBeUndefined();

    // Falsy adopted value (0) is properly tracked
    expect(so.adopt(0, (n) => order.push(`adopt:${n}`))).toBe(0);
    expect(so.size).toBe(1);
    expect(so.current).toBe(0);
    expect(so.is(0)).toBe(true);

    // defer replaces adopted value
    so.defer(() => order.push("defer"));
    expect(order).toEqual(["d1", "d2", "adopt:0"]);

    so.dispose();
    expect(so.disposed).toBe(true);
    expect(so.signal.aborted).toBe(true);
    expect(so.size).toBe(0);
    expect(order).toEqual(["d1", "d2", "adopt:0", "defer"]);

    {
      using o = scopeOne();
      o.defer(() => order.push("using"));
    }
    expect(order).toEqual(["d1", "d2", "adopt:0", "defer", "using"]);

    // dispose when empty
    const empty = scopeOne();
    empty.dispose();
    expect(empty.disposed).toBe(true);
  });

  it("accepts initial disposable and options", () => {
    const fn = vi.fn();
    const so = scopeOne(fn, { name: "init" });
    expect(so.size).toBe(1);
    expect(so.current).toBe(fn);
    so.dispose();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("supports remove(), flush(), error propagation, and move()", () => {
    const so = scopeOne();
    expect(so.remove()).toBeUndefined();

    const fn = vi.fn();
    so.use(fn);
    expect(so.remove()).toBe(fn);
    expect(fn).not.toHaveBeenCalled();
    expect(so.size).toBe(0);

    // Error propagation on dispose
    const errScope = scopeOne();
    errScope.defer(() => {
      throw new Error("one-fail");
    });
    expect(() => errScope.dispose()).toThrow("one-fail");
    expect(errScope.disposed).toBe(true);

    // flush after dispose is no-op
    errScope.flush();

    // move with child scope + auto-detach
    const s1 = scopeOne();
    const child = s1.use(scope());
    const s2 = s1.move();
    expect(s1.disposed).toBe(true);
    expect(s2.current).toBe(child);

    child.dispose();
    expect(s2.size).toBe(0);
    s2.dispose();

    // move empty
    const e1 = scopeOne();
    const e2 = e1.move();
    expect(e1.disposed).toBe(true);
    expect(e2.size).toBe(0);
    e2.dispose();
  });

  it("cleans up and throws ReferenceError after dispose", () => {
    const so = scopeOne();
    so.dispose();

    const fn = vi.fn();
    expect(() => so.use(fn)).toThrow(ReferenceError);
    expect(fn).toHaveBeenCalledTimes(1);

    expect(() => so.use(undefined)).toThrow(ReferenceError);

    const clean = vi.fn();
    expect(() => so.adopt("v", clean)).toThrow(ReferenceError);
    expect(clean).toHaveBeenCalledWith("v");

    const def = vi.fn();
    expect(() => so.defer(def)).toThrow(ReferenceError);
    expect(def).toHaveBeenCalledTimes(1);
  });
});
