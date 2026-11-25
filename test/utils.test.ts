import { describe, expect, it, vi } from "vitest";
import { dispose, isDisposable } from "../src/index.ts";

describe("utils", () => {
  describe("isDisposable", () => {
    it("recognizes functions, IDisposable, and TC39 Disposable", () => {
      expect(isDisposable(() => {})).toBe(true);
      expect(isDisposable({ dispose() {} })).toBe(true);
      expect(isDisposable({ [Symbol.dispose]() {} })).toBe(true);
    });

    it("rejects non-disposable values", () => {
      expect(isDisposable(null)).toBe(false);
      expect(isDisposable(undefined)).toBe(false);
      expect(isDisposable(0)).toBe(false);
      expect(isDisposable("str")).toBe(false);
      expect(isDisposable({})).toBe(false);
      expect(isDisposable({ dispose: 123 })).toBe(false);
      expect(isDisposable({ [Symbol.dispose]: "nope" })).toBe(false);
    });
  });

  describe("dispose", () => {
    it("disposes function, IDisposable, and TC39 Disposable", () => {
      const fn = vi.fn();
      const idisp = { dispose: vi.fn() };
      const sym = { [Symbol.dispose]: vi.fn() };

      dispose(fn);
      dispose(idisp);
      dispose(sym);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(idisp.dispose).toHaveBeenCalledTimes(1);
      expect(sym[Symbol.dispose]).toHaveBeenCalledTimes(1);
    });

    it("prefers Symbol.dispose over dispose on objects, and invokes functions directly", () => {
      const obj = {
        dispose: vi.fn(),
        [Symbol.dispose]: vi.fn(),
      };
      dispose(obj);
      expect(obj[Symbol.dispose]).toHaveBeenCalledTimes(1);
      expect(obj.dispose).not.toHaveBeenCalled();

      const fn = vi.fn();
      dispose(fn);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("is a no-op for null, undefined, and non-disposable objects", () => {
      expect(() => dispose(null)).not.toThrow();
      expect(() => dispose(undefined)).not.toThrow();
      expect(() => dispose({})).not.toThrow();
    });

    it("propagates errors without swallowing", () => {
      expect(() =>
        dispose(() => {
          throw new Error("boom");
        }),
      ).toThrow("boom");
    });
  });
});
