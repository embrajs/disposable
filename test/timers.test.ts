import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { interval, scope, timeout } from "../src/index.ts";

describe("timers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("timeout", () => {
    it("fires after delay and auto-detaches from scope", () => {
      const s = scope();
      const fn = vi.fn();
      s.use(timeout(fn, 100));
      expect(s.size).toBe(1);

      vi.advanceTimersByTime(99);
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(s.size).toBe(0);

      s.dispose();
    });

    it("cancels before firing on early stop(), scope.dispose(), or using", () => {
      const s = scope();
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      const stop1 = s.use(timeout(fn1, 100));
      s.use(timeout(fn2));

      stop1();
      expect(s.size).toBe(1);

      s.dispose();
      vi.advanceTimersByTime(200);
      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).not.toHaveBeenCalled();

      const fn3 = vi.fn();
      {
        using _ = timeout(fn3, 50);
      }
      vi.advanceTimersByTime(100);
      expect(fn3).not.toHaveBeenCalled();
    });
  });

  describe("interval", () => {
    it("fires repeatedly and stops on early cancel, scope.dispose(), or using", () => {
      const s = scope();
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      const stop1 = s.use(interval(fn1, 100));
      s.use(interval(fn2, 100));
      expect(s.size).toBe(2);

      vi.advanceTimersByTime(250);
      expect(fn1).toHaveBeenCalledTimes(2);
      expect(fn2).toHaveBeenCalledTimes(2);

      stop1();
      expect(s.size).toBe(1);
      vi.advanceTimersByTime(200);
      expect(fn1).toHaveBeenCalledTimes(2);
      expect(fn2).toHaveBeenCalledTimes(4);

      s.dispose();
      vi.advanceTimersByTime(200);
      expect(fn2).toHaveBeenCalledTimes(4);

      const fn3 = vi.fn();
      {
        using _ = interval(fn3, 50);
        vi.advanceTimersByTime(50);
      }
      vi.advanceTimersByTime(150);
      expect(fn3).toHaveBeenCalledTimes(1);
    });
  });
});
