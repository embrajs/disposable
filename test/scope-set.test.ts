import { describe, expect, it, vi } from "vitest";
import { scope, scopeSet } from "../src/index.ts";

describe("scopeSet", () => {
  it("deduplicates entries across use, adopt, and defer and disposes in LIFO order", () => {
    const order: string[] = [];
    const ss = scopeSet();
    expect(Object.prototype.toString.call(ss)).toBe("[object ScopeSet]");
    expect(ss.size).toBe(0);
    expect(ss.signal.aborted).toBe(false);

    const fn = () => order.push("fn");
    const obj = { id: 1 };
    const deferFn = () => order.push("defer");

    ss.use(fn);
    ss.use(fn); // duplicate ignored
    ss.use(null);
    ss.adopt(obj, (v) => order.push(`adopt:${v.id}`));
    ss.adopt(obj, () => order.push("duplicate-adopt")); // duplicate ignored
    ss.defer(deferFn);
    ss.defer(deferFn); // duplicate ignored

    expect(ss.size).toBe(3);
    expect(ss.has(fn)).toBe(true);
    expect(ss.has(obj)).toBe(true);
    expect(ss.has(deferFn)).toBe(true);
    expect(ss.has({})).toBe(false);

    ss.dispose();
    expect(ss.disposed).toBe(true);
    expect(ss.signal.aborted).toBe(true);
    expect(ss.size).toBe(0);
    expect(order).toEqual(["defer", "adopt:1", "fn"]);

    {
      using s = scopeSet();
      s.defer(() => order.push("using"));
    }
    expect(order).toEqual(["defer", "adopt:1", "fn", "using"]);
  });

  it("accepts initial iterable and options", () => {
    const fn = vi.fn();
    const ss = scopeSet([fn, fn], { name: "set" });
    expect(ss.size).toBe(1);
    ss.dispose();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("supports remove() and targeted flush(value)", () => {
    const ss = scopeSet();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const child = scope();

    expect(ss.remove(fn1)).toBe(false);

    ss.use(fn1);
    ss.use(fn2);
    ss.use(child);

    expect(ss.remove(fn1)).toBe(true);
    expect(ss.has(fn1)).toBe(false);
    expect(fn1).not.toHaveBeenCalled();

    expect(ss.remove(child)).toBe(true);
    child.dispose();
    expect(ss.size).toBe(1);

    ss.flush(fn2);
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(ss.size).toBe(0);

    // flush missing item is no-op
    ss.flush(fn2);

    // flush all
    const fn3 = vi.fn();
    ss.use(fn3);
    ss.flush();
    expect(fn3).toHaveBeenCalledTimes(1);
    expect(ss.size).toBe(0);

    // flush on empty
    ss.flush();

    ss.dispose();
    // flush after dispose is no-op
    ss.flush();
  });

  it("treats flush(undefined) as a targeted flush, not a full flush", () => {
    const ss = scopeSet();
    const fnOther = vi.fn();
    const fnUndef = vi.fn();

    ss.use(fnOther);

    // Calling flush(undefined) when undefined is not stored is a no-op
    ss.flush(undefined);
    expect(fnOther).not.toHaveBeenCalled();
    expect(ss.size).toBe(1);

    // Calling flush(undefined) when undefined is adopted flushes only undefined
    ss.adopt(undefined, fnUndef);
    expect(ss.size).toBe(2);
    ss.flush(undefined);
    expect(fnUndef).toHaveBeenCalledTimes(1);
    expect(fnOther).not.toHaveBeenCalled();
    expect(ss.has(undefined)).toBe(false);
    expect(ss.has(fnOther)).toBe(true);

    // Calling flush() with no arguments flushes all remaining entries
    ss.flush();
    expect(fnOther).toHaveBeenCalledTimes(1);
    expect(ss.size).toBe(0);
  });

  it("auto-detaches child scopes and supports move()", () => {
    const ss1 = scopeSet();
    const child = ss1.use(scope());
    const fn = vi.fn();
    ss1.use(fn);

    const ss2 = ss1.move();
    expect(ss1.disposed).toBe(true);
    expect(ss2.size).toBe(2);

    child.dispose();
    expect(ss2.size).toBe(1);
    expect(ss2.has(child)).toBe(false);

    ss2.dispose();
    expect(fn).toHaveBeenCalledTimes(1);

    // move empty
    const empty1 = scopeSet();
    const empty2 = empty1.move();
    expect(empty1.disposed).toBe(true);
    expect(empty2.size).toBe(0);
    empty2.dispose();
  });

  it("throws ReferenceError after dispose", () => {
    const ss = scopeSet();
    ss.dispose();

    const fn = vi.fn();
    expect(() => ss.use(fn)).toThrow(ReferenceError);
    expect(fn).not.toHaveBeenCalled();

    expect(() => ss.use(undefined)).toThrow(ReferenceError);

    const clean = vi.fn();
    expect(() => ss.adopt("x", clean)).toThrow(ReferenceError);
    expect(clean).not.toHaveBeenCalled();

    const def = vi.fn();
    expect(() => ss.defer(def)).toThrow(ReferenceError);
    expect(def).not.toHaveBeenCalled();
  });
});
