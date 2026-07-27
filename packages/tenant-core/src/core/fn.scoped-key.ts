/**
 * @file Builds collision-safe keys for tenant-scoped in-memory registries and stores.
 */

export function fnScopedKey(namespace: string, parts: readonly string[]): string {
  return [namespace, ...parts]
    .map((part) => `${part.length}:${part}`)
    .join('|');
}
