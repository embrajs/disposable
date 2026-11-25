import { type DevScopeMeta, getDevRegistry } from "../dev.ts";
import type { BaseScope, ScopeKind } from "../types.ts";

/**
 * Snapshot of a disposal scope's state and active child scopes.
 */
export interface ScopeSnapshot {
  readonly name: string | undefined;
  readonly kind: ScopeKind | "unknown";
  readonly disposed: boolean;
  readonly size: number;
  readonly children: ScopeSnapshot[];
  readonly createdAt?: string;
  readonly disposedAt?: string;
  readonly disposedReason?: "disposed" | "moved";
}

/**
 * Result returned by {@link trackLeaks}.
 */
export interface LeakReport<T> {
  readonly result: T;
  readonly leaks: ScopeSnapshot[];
  readonly text: string;
}

/**
 * Stateful leak tracker for async tests or `beforeEach` / `afterEach` hooks.
 */
export interface LeakTracker extends Disposable {
  /** Snapshot of scopes created since tracking began that are still alive. */
  leaks(): ScopeSnapshot[];
  /** Plain-text summary of currently leaked scopes. */
  format(): string;
  /** Stop tracking new scopes. */
  stop(): void;
  [Symbol.dispose](): void;
}

function inferKind(target: BaseScope): ScopeKind | "unknown" {
  const tag = Object.prototype.toString.call(target);
  if (tag === "[object Scope]") return "scope";
  if (tag === "[object ScopeSet]") return "scopeSet";
  if (tag === "[object ScopeMap]") return "scopeMap";
  if (tag === "[object ScopeOne]") return "scopeOne";
  return "unknown";
}

function inspectNode(target: BaseScope, visited: Set<object>): ScopeSnapshot {
  let meta: DevScopeMeta | undefined;
  if (__DEV__) {
    meta = getDevRegistry().meta.get(target);
  }
  const children: ScopeSnapshot[] = [];
  if (meta) {
    visited.add(target);
    for (const child of meta.children) {
      if (!visited.has(child)) {
        children.push(inspectNode(child as BaseScope, visited));
      }
    }
  }
  return {
    name: meta?.name,
    kind: meta ? meta.kind : inferKind(target),
    disposed: target.disposed,
    size: target.size,
    children,
    ...(meta
      ? {
          createdAt: meta.createdAt,
          ...(meta.disposedAt !== undefined ? { disposedAt: meta.disposedAt } : {}),
          ...(meta.disposedReason !== undefined ? { disposedReason: meta.disposedReason } : {}),
        }
      : {}),
  };
}

/**
 * Capture a snapshot of a scope and its live child scopes.
 */
export function inspect(target: BaseScope): ScopeSnapshot {
  return inspectNode(target, new Set());
}

function formatLine(node: ScopeSnapshot): string {
  const label = node.name ? `${node.name} (${node.kind})` : node.kind;
  const status = node.disposed ? (node.disposedReason === "moved" ? "moved" : "disposed") : "alive";
  return `${label} [${status}, size=${node.size}]`;
}

function renderLines(node: ScopeSnapshot, prefix: string, isLast: boolean, isRoot: boolean, lines: string[]): void {
  if (isRoot) {
    lines.push(formatLine(node));
  } else {
    lines.push(`${prefix}${isLast ? "└── " : "├── "}${formatLine(node)}`);
  }
  const childPrefix = isRoot ? "" : `${prefix}${isLast ? "    " : "│   "}`;
  for (let i = 0; i < node.children.length; i++) {
    renderLines(node.children[i], childPrefix, i === node.children.length - 1, false, lines);
  }
}

/**
 * Format a scope and its child tree as a plain-text tree.
 */
export function formatTree(target: BaseScope): string {
  const lines: string[] = [];
  renderLines(inspect(target), "", true, true, lines);
  return lines.join("\n");
}

function formatLeaks(leaks: ScopeSnapshot[]): string {
  if (leaks.length === 0) {
    return "No leaked scopes.";
  }
  const lines = [`Leaked ${leaks.length} scope${leaks.length === 1 ? "" : "s"}:`];
  for (const leak of leaks) {
    lines.push(`- ${formatLine(leak)}`);
    lines.push(String(leak.createdAt));
  }
  return lines.join("\n");
}

/**
 * Create a leak tracker that records all scopes created until {@link LeakTracker.stop} is called
 * and reports any that remain undisposed. No-op in production builds.
 */
export function createLeakTracker(): LeakTracker {
  const active = new Set<object>();
  let unsub: (() => void) | undefined;
  if (__DEV__) {
    const { leakTrackers } = getDevRegistry();
    leakTrackers.add(active);
    unsub = () => {
      leakTrackers.delete(active);
    };
  }

  const stop = (): void => {
    if (unsub) {
      const fn = unsub;
      unsub = undefined;
      fn();
    }
  };

  const leaks = (): ScopeSnapshot[] => {
    const out: ScopeSnapshot[] = [];
    for (const s of active) {
      out.push(inspect(s as BaseScope));
    }
    return out;
  };

  return {
    leaks,
    format: () => formatLeaks(leaks()),
    stop,
    [Symbol.dispose]: stop,
  };
}

/**
 * Execute `fn` and report any scopes created during execution that were not disposed or moved.
 */
export function trackLeaks<T>(fn: () => T): LeakReport<T> {
  const tracker = createLeakTracker();
  let result: T;
  try {
    result = fn();
  } finally {
    tracker.stop();
  }
  const leaks = tracker.leaks();
  return {
    result,
    leaks,
    text: formatLeaks(leaks),
  };
}
