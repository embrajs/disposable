import { describe, expect, it, vi } from "vitest";
import { scope } from "../src/index.ts";
import { setDevMode } from "./setup.ts";

describe("scope", () => {
  it("disposes resources in LIFO order via use and adopt", () => {
    const order: string[] = [];
    const s = scope();

    expect(s.disposed).toBe(false);
    expect(s.size).toBe(0);

    const fn = s.use(() => order.push("fn"));
    const idisp = s.use({ dispose: () => order.push("idisp") });
    const sym = s.use({ [Symbol.dispose]: () => order.push("sym") });
    const adopted = s.adopt({ id: 42 }, (v) => order.push(`adopt:${v.id}`));

    expect(typeof fn).toBe("function");
    expect(idisp).toBeDefined();
    expect(sym).toBeDefined();
    expect(adopted).toEqual({ id: 42 });
    expect(s.size).toBe(4);

    // null / undefined are no-ops
    expect(s.use(null)).toBeNull();
    expect(s.use(undefined)).toBeUndefined();
    expect(s.size).toBe(4);

    s.dispose();

    expect(s.disposed).toBe(true);
    expect(s.size).toBe(0);
    expect(order).toEqual(["adopt:42", "sym", "idisp", "fn"]);

    // idempotent dispose
    s.dispose();
    expect(order).toEqual(["adopt:42", "sym", "idisp", "fn"]);
  });

  it("accepts initial items and options", () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const s = scope([fn1, null, undefined, fn2], { name: "init" });
    expect(s.size).toBe(2);
    s.dispose();
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it("works with TC39 using and detached dispose()", () => {
    const fn = vi.fn();
    {
      using s = scope();
      s.use(fn);
      expect(fn).not.toHaveBeenCalled();
    }
    expect(fn).toHaveBeenCalledTimes(1);

    const fn2 = vi.fn();
    const s2 = scope();
    s2.use(fn2);
    const detached = s2.dispose;
    detached();
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(s2.disposed).toBe(true);
  });

  it("supports flush() without closing the scope", () => {
    const order: string[] = [];
    const s = scope();
    s.flush(); // empty flush
    s.use(() => order.push("a"));
    s.use(() => order.push("b"));
    s.flush();

    expect(s.disposed).toBe(false);
    expect(s.size).toBe(0);
    expect(order).toEqual(["b", "a"]);

    s.use(() => order.push("c"));
    s.dispose();
    expect(order).toEqual(["b", "a", "c"]);

    // flush after dispose is a no-op
    expect(() => s.flush()).not.toThrow();
  });

  it("prevents re-entrant disposal loops", () => {
    const s = scope();
    let count = 0;
    s.use(() => {
      count++;
      s.dispose();
    });
    s.dispose();
    expect(count).toBe(1);
  });

  it("collects errors and disposes remaining resources", () => {
    const order: string[] = [];
    const s1 = scope();
    s1.use(() => order.push("first"));
    s1.use(() => {
      throw new Error("single");
    });
    s1.use(() => order.push("last"));

    expect(() => s1.dispose()).toThrow("single");
    expect(order).toEqual(["last", "first"]);

    const s2 = scope();
    s2.use(() => {
      throw new Error("e1");
    });
    s2.use(() => {
      throw new Error("e2");
    });

    try {
      s2.dispose();
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AggregateError);
      expect((err as AggregateError).errors).toHaveLength(2);
    }
  });

  it("supports lazy AbortSignal that aborts on dispose", () => {
    const s = scope();
    const sig = s.signal;
    expect(sig.aborted).toBe(false);
    expect(s.signal).toBe(sig);

    s.dispose();
    expect(sig.aborted).toBe(true);
    expect(s.signal).toBe(sig);

    // Accessing signal on already-disposed scope without prior signal
    const s2 = scope();
    s2.dispose();
    expect(s2.signal.aborted).toBe(true);
  });

  it("cascades disposal to nested child scopes", () => {
    const parent = scope();
    const child = parent.use(scope());
    const alreadyDead = scope();
    alreadyDead.dispose();
    parent.use(alreadyDead);

    expect(parent.size).toBe(2);
    parent.dispose();
    expect(child.disposed).toBe(true);
    expect(parent.size).toBe(0);
  });

  it("throws ReferenceError when used after dispose", () => {
    const s = scope({ name: "closed" });
    s.dispose();

    const fn = vi.fn();
    expect(() => s.use(fn)).toThrow(ReferenceError);
    expect(fn).not.toHaveBeenCalled();

    expect(() => s.use(null)).toThrow(ReferenceError);

    const adoptCleanup = vi.fn();
    expect(() => s.adopt(123, adoptCleanup)).toThrow(ReferenceError);
    expect(adoptCleanup).not.toHaveBeenCalled();
  });

  it("includes disposal stack in dev mode and omits it in prod mode", () => {
    const s = scope({ name: "dev-scope" });
    s.dispose();
    expect(() => s.use(() => {})).toThrow(/Originally disposed at:/);

    setDevMode(false);
    const prod = scope({ name: "prod-scope" });
    const prodChild = prod.use(scope());
    const prodChild2 = prod.use(scope());
    prodChild.dispose();
    prod.dispose();
    expect(prodChild2.disposed).toBe(true);
    expect(() => prod.use(() => {})).toThrow("disposed");

    // Scope created in prod mode, then drained/accessed in dev mode (no dev meta)
    setDevMode(false);
    const prodNoMeta = scope();
    prodNoMeta.use(scope());
    setDevMode(true);
    prodNoMeta.use(scope());
    prodNoMeta.dispose();
    expect(() => prodNoMeta.use(() => {})).toThrow("disposed");
  });
});
