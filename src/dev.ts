import type { ScopeKind } from "./types.ts";

/**
 * Dev metadata attached to scopes when `__DEV__` is enabled.
 * @internal
 */
export interface DevScopeMeta {
  readonly kind: ScopeKind;
  readonly name?: string;
  readonly createdAt: string;
  disposedAt?: string;
  disposedReason?: "disposed" | "moved";
  readonly children: Set<object>;
}

/**
 * Shared dev registry stored on `globalThis` so `@embra/disposable` and `@embra/disposable/debug`
 * share state across separate bundle entry points without polluting public exports.
 * @internal
 */
export interface DevRegistry {
  readonly meta: WeakMap<object, DevScopeMeta>;
  readonly leakTrackers: Set<Set<object>>;
}

const DEV_REGISTRY_KEY = /* @__PURE__ */ Symbol.for("@embra/disposable/dev");

/** @internal */
export function getDevRegistry(): DevRegistry {
  const globals = globalThis as Record<symbol, DevRegistry | undefined>;
  return (globals[DEV_REGISTRY_KEY] ??= {
    meta: new WeakMap(),
    leakTrackers: new Set(),
  });
}

function captureStack(): string {
  const stack = new Error().stack as string;
  const lines = stack.split("\n");
  // Drop "Error" header and internal frames inside this library
  return lines.slice(3).join("\n");
}

/** @internal */
export function registerDevScope(scope: object, kind: ScopeKind, name?: string): void {
  const { meta, leakTrackers } = getDevRegistry();
  meta.set(scope, {
    kind,
    name,
    createdAt: captureStack(),
    children: new Set(),
  });
  for (const tracker of leakTrackers) {
    tracker.add(scope);
  }
}

/** @internal */
export function markDevDisposed(scope: object, reason: "disposed" | "moved" = "disposed"): void {
  const { meta, leakTrackers } = getDevRegistry();
  const entry = meta.get(scope);
  if (entry) {
    entry.disposedAt = captureStack();
    entry.disposedReason = reason;
  }
  for (const tracker of leakTrackers) {
    tracker.delete(scope);
  }
}

/** @internal */
export function linkDevChild(parent: object, child: object): void {
  getDevRegistry().meta.get(parent)?.children.add(child);
}

/** @internal */
export function unlinkDevChild(parent: object, child: object): void {
  getDevRegistry().meta.get(parent)?.children.delete(child);
}

/** @internal */
export function getDevDisposedMessage(scope: object): string {
  const entry = getDevRegistry().meta.get(scope);
  if (!entry) {
    return "disposed";
  }
  const label = entry.name ? `${entry.kind} "${entry.name}"` : entry.kind;
  const action = entry.disposedReason === "moved" ? "moved" : "disposed";
  return `Cannot use ${action} ${label}.\nOriginally ${action} at:\n${entry.disposedAt}`;
}
