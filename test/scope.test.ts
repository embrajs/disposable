import { describe, expect, it, vi } from "vitest";
import { scope } from "../src/index.ts";
import { setDevMode } from "./setup.ts";

describe("scope", () => {
  it("disposes resources in LIFO order via use, adopt, and defer", () => {
    const order: string[] = [];
    const s = scope();

    expect(Object.prototype.toString.call(s)).toBe("[object Scope]");
    expect(s.disposed).toBe(false);
    expect(s.size).toBe(0);

    const fn = s.use(() => order.push("fn"));
    const idisp = s.use({ dispose: () => order.push("idisp") });
    const sym = s.use({ [Symbol.dispose]: () => order.push("sym") });
    const adopted = s.adopt({ id: 42 }, (v) => order.push(`adopt:${v.id}`));
    s.defer(() => order.push("defer"));

    expect(typeof fn).toBe("function");
    expect(idisp).toBeDefined();
    expect(sym).toBeDefined();
    expect(adopted).toEqual({ id: 42 });
    expect(s.size).toBe(5);

    // null / undefined are no-ops
    expect(s.use(null)).toBeNull();
    expect(s.use(undefined)).toBeUndefined();
    expect(s.size).toBe(5);

    s.dispose();

    expect(s.disposed).toBe(true);
    expect(s.size).toBe(0);
    expect(order).toEqual(["defer", "adopt:42", "sym", "idisp", "fn"]);

    // idempotent dispose
    s.dispose();
    expect(order).toEqual(["defer", "adopt:42", "sym", "idisp", "fn"]);
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
      s.defer(fn);
      expect(fn).not.toHaveBeenCalled();
    }
    expect(fn).toHaveBeenCalledTimes(1);

    const fn2 = vi.fn();
    const s2 = scope();
    s2.defer(fn2);
    const detached = s2.dispose;
    detached();
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(s2.disposed).toBe(true);
  });

  it("supports flush() without closing the scope", () => {
    const order: string[] = [];
    const s = scope();
    s.flush(); // empty flush
    s.defer(() => order.push("a"));
    s.defer(() => order.push("b"));
    s.flush();

    expect(s.disposed).toBe(false);
    expect(s.size).toBe(0);
    expect(order).toEqual(["b", "a"]);

    s.defer(() => order.push("c"));
    s.dispose();
    expect(order).toEqual(["b", "a", "c"]);

    // flush after dispose is a no-op
    expect(() => s.flush()).not.toThrow();
  });

  it("prevents re-entrant disposal loops", () => {
    const s = scope();
    let count = 0;
    s.defer(() => {
      count++;
      s.dispose();
    });
    s.dispose();
    expect(count).toBe(1);
  });

  it("collects errors and disposes remaining resources", () => {
    const order: string[] = [];
    const s1 = scope();
    s1.defer(() => order.push("first"));
    s1.defer(() => {
      throw new Error("single");
    });
    s1.defer(() => order.push("last"));

    expect(() => s1.dispose()).toThrow("single");
    expect(order).toEqual(["last", "first"]);

    const s2 = scope();
    s2.defer(() => {
      throw new Error("e1");
    });
    s2.defer(() => {
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

  it("transfers ownership with move() including active AbortSignal and child scopes", () => {
    const order: string[] = [];
    const s1 = scope({ name: "init" });
    const sig = s1.signal;
    const child = s1.use(scope());
    child.defer(() => order.push("child"));
    s1.defer(() => order.push("parent"));

    const s2 = s1.move();
    expect(s1.disposed).toBe(true);
    expect(s1.size).toBe(0);
    expect(sig.aborted).toBe(false);
    expect(s1.signal.aborted).toBe(true);
    expect(s2.disposed).toBe(false);
    expect(s2.size).toBe(2);
    expect(s2.signal).toBe(sig);

    // Moving an empty scope also works
    const empty1 = scope();
    const empty2 = empty1.move();
    expect(empty1.disposed).toBe(true);
    expect(empty2.size).toBe(0);
    empty2.dispose();

    // Child early dispose detaches from s2 (not s1)
    child.dispose();
    expect(s2.size).toBe(1);
    expect(order).toEqual(["child"]);

    s2.dispose();
    expect(sig.aborted).toBe(true);
    expect(order).toEqual(["child", "parent"]);
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

  it("auto-detaches child scopes on early disposal", () => {
    const parent = scope();
    const child = parent.use(scope());
    const alreadyDead = scope();
    alreadyDead.dispose();
    parent.use(alreadyDead);

    expect(parent.size).toBe(2);
    child.dispose();
    expect(parent.size).toBe(1);

    parent.dispose();
    expect(parent.size).toBe(0);
  });

  it("cleans up passed resources and throws ReferenceError when used after dispose", () => {
    const s = scope({ name: "closed" });
    s.dispose();

    const fn = vi.fn();
    expect(() => s.use(fn)).toThrow(ReferenceError);
    expect(fn).toHaveBeenCalledTimes(1);

    expect(() => s.use(null)).toThrow(ReferenceError);

    const adoptCleanup = vi.fn();
    expect(() => s.adopt(123, adoptCleanup)).toThrow(ReferenceError);
    expect(adoptCleanup).toHaveBeenCalledWith(123);

    const deferred = vi.fn();
    expect(() => s.defer(deferred)).toThrow(ReferenceError);
    expect(deferred).toHaveBeenCalledTimes(1);

    expect(() => s.move()).toThrow(ReferenceError);

    // Preserves cause if emergency cleanup throws
    try {
      s.defer(() => {
        throw new Error("cleanup-fail");
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ReferenceError);
      expect((err as ReferenceError).cause).toBeInstanceOf(Error);
    }
  });

  it("includes disposal stack in dev mode and omits it in prod mode", () => {
    const s = scope({ name: "dev-scope" });
    s.dispose();
    expect(() => s.defer(() => {})).toThrow(/Originally disposed at:/);

    const moved = scope();
    const target = moved.move();
    expect(() => moved.defer(() => {})).toThrow(/Originally moved at:/);
    target.dispose();

    setDevMode(false);
    const prod = scope({ name: "prod-scope" });
    const prodChild = prod.use(scope());
    const prodChild2 = prod.use(scope());
    prodChild.dispose();
    const prodMoved = prod.move();
    prodMoved.dispose();
    expect(prodChild2.disposed).toBe(true);
    expect(() => prod.defer(() => {})).toThrow("Cannot use a disposed scope");

    // Scope created in prod mode, then disposed & accessed in dev mode (no dev meta)
    const prodNoMeta = scope();
    setDevMode(true);
    prodNoMeta.dispose();
    expect(() => prodNoMeta.defer(() => {})).toThrow("Cannot use a disposed scope");
  });
});
