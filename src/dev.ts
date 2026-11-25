import type { ScopeKind } from "./types.ts";
import type { ScopeEntry } from "./utils.ts";

/**
 * Dev metadata attached to scopes when `__DEV__` is enabled.
 * @internal
 */
export interface DevScopeMeta {
  readonly kind: ScopeKind;
  readonly name?: string;
  readonly createdAt: string;
  disposedAt?: string;
  readonly children: Set<object>;
  readonly parents: Set<object>;
}

/**
 * Shared dev registry stored on `globalThis` so `@embra/disposable` and `@embra/disposable/debug`
 * share state across separate bundle entry points without polluting public exports.
 * @internal
 */
export interface DevRegistry {
  readonly meta: WeakMap<object, DevScopeMeta>;
  readonly byDispose: WeakMap<object, object>;
  readonly leakTrackers: Set<Set<object>>;
}

const DEV_REGISTRY_KEY = /* @__PURE__ */ Symbol.for("@embra/disposable/dev");

/** @internal */
export function getDevRegistry(): DevRegistry {
  const globals = globalThis as Record<symbol, DevRegistry | undefined>;
  return (globals[DEV_REGISTRY_KEY] ??= {
    meta: new WeakMap(),
    byDispose: new WeakMap(),
    leakTrackers: new Set(),
  });
}

function captureStack(): string {
  const stack = new Error().stack as string;
  const lines = stack.split("\n");
  // Drop "Error" header and internal frames inside this library
  return lines.slice(3).join("\n");
}

function resolveDevScope(value: unknown): object | undefined {
  const { meta, byDispose } = getDevRegistry();
  if (meta.has(value as object)) return value as object;
  if (typeof value === "function") return byDispose.get(value);
  const dispose = (value as { dispose?: unknown }).dispose;
  return typeof dispose === "function" ? byDispose.get(dispose) : undefined;
}

/** @internal */
export function registerDevScope(scope: { dispose: () => void }, kind: ScopeKind, name?: string): void {
  const { meta, byDispose, leakTrackers } = getDevRegistry();
  meta.set(scope, {
    kind,
    name,
    createdAt: captureStack(),
    children: new Set(),
    parents: new Set(),
  });
  byDispose.set(scope.dispose, scope);
  for (const tracker of leakTrackers) {
    tracker.add(scope);
  }
}

/** @internal */
export function aliasDevDispose(alias: () => void, target: () => void): void {
  const { byDispose } = getDevRegistry();
  const scope = byDispose.get(target);
  if (scope) {
    byDispose.set(alias, scope);
  }
}

/** @internal */
export function markDevDisposed(scope: object): void {
  const { meta, leakTrackers } = getDevRegistry();
  const entry = meta.get(scope);
  if (entry) {
    entry.disposedAt = captureStack();
    for (const parent of entry.parents) {
      (meta.get(parent) as DevScopeMeta).children.delete(scope);
    }
    entry.parents.clear();
  }
  for (const tracker of leakTrackers) {
    tracker.delete(scope);
  }
}

/** @internal */
export function linkDevValue(parent: object, value: unknown): void {
  const child = resolveDevScope(value);
  if (child) {
    const { meta } = getDevRegistry();
    const parentMeta = meta.get(parent);
    const childMeta = meta.get(child);
    if (parentMeta && childMeta && childMeta.disposedAt === undefined) {
      parentMeta.children.add(child);
      childMeta.parents.add(parent);
    }
  }
}

/** @internal */
export function unlinkDevValue(parent: object, entry: ScopeEntry): void {
  if (!entry.f) {
    const child = resolveDevScope(entry.v);
    if (child) {
      const { meta } = getDevRegistry();
      const parentMeta = meta.get(parent);
      if (parentMeta) {
        parentMeta.children.delete(child);
        (meta.get(child) as DevScopeMeta).parents.delete(parent);
      }
    }
  }
}

/** @internal */
export function clearDevChildren(parent: object): void {
  const { meta } = getDevRegistry();
  const parentMeta = meta.get(parent);
  if (parentMeta) {
    for (const child of parentMeta.children) {
      (meta.get(child) as DevScopeMeta).parents.delete(parent);
    }
    parentMeta.children.clear();
  }
}

/** @internal */
export function getDevDisposedMessage(scope: object): string {
  const entry = getDevRegistry().meta.get(scope);
  if (!entry) {
    return "disposed";
  }
  const label = entry.name ? `${entry.kind} "${entry.name}"` : entry.kind;
  return `Cannot use disposed ${label}.\nOriginally disposed at:\n${entry.disposedAt}`;
}
