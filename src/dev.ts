import type { ScopeKind } from "./types.ts";

/**
 * Dev metadata attached to scopes when `__DEV__` is enabled.
 * @hidden
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
 * Hook bundle consumed by `@embra/disposable/debug`.
 * @hidden
 */
export interface DevDebugHooks {
  getMeta(scope: object): DevScopeMeta | undefined;
  addLeakTracker(tracker: Set<object>): () => void;
}

const metaMap = new WeakMap<object, DevScopeMeta>();
const leakTrackers = new Set<Set<object>>();

function captureStack(): string {
  const stack = new Error().stack as string;
  const lines = stack.split("\n");
  // Drop "Error" header and internal frames inside this library
  return lines.slice(3).join("\n");
}

/** @internal */
export function registerDevScope(scope: object, kind: ScopeKind, name?: string): void {
  metaMap.set(scope, {
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
  const meta = metaMap.get(scope);
  if (meta) {
    meta.disposedAt = captureStack();
    meta.disposedReason = reason;
  }
  for (const tracker of leakTrackers) {
    tracker.delete(scope);
  }
}

/** @internal */
export function linkDevChild(parent: object, child: object): void {
  metaMap.get(parent)?.children.add(child);
}

/** @internal */
export function unlinkDevChild(parent: object, child: object): void {
  metaMap.get(parent)?.children.delete(child);
}

/** @internal */
export function getDevDisposedMessage(scope: object): string {
  const meta = metaMap.get(scope);
  if (!meta) {
    return "Cannot use a disposed scope";
  }
  const label = meta.name ? `${meta.kind} "${meta.name}"` : meta.kind;
  const action = meta.disposedReason === "moved" ? "moved" : "disposed";
  return `Cannot use ${action} ${label}.\nOriginally ${action} at:\n${meta.disposedAt}`;
}

/** @hidden */
export function _getDevHooks(): DevDebugHooks | undefined {
  if (__DEV__) {
    return {
      getMeta: (scope) => metaMap.get(scope),
      addLeakTracker: (tracker) => {
        leakTrackers.add(tracker);
        return () => {
          leakTrackers.delete(tracker);
        };
      },
    };
  }
  return undefined;
}
