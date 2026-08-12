export type TArgs = Readonly<{
  source: string;
  registryUrl: string;
}>;

type TPackageLock = {
  packages?: Record<string, {
    resolved?: unknown;
    integrity?: unknown;
  }>;
};

/**
 * Removes stale integrity pins only for Omnidraw packages served by the
 * mutable development registry. Public and third-party registry entries stay
 * frozen exactly as authored.
 */
export function fnMutableRegistryPackageLock(args: TArgs): string {
  const packageLock = JSON.parse(args.source) as TPackageLock;
  let changed = false;
  for (const [path, entry] of Object.entries(packageLock.packages ?? {})) {
    if (
      !/(?:^|\/)node_modules\/@omnidraw\//u.test(path)
      || typeof entry.resolved !== 'string'
      || !entry.resolved.startsWith(args.registryUrl)
      || !Object.hasOwn(entry, 'integrity')
    ) continue;
    delete entry.integrity;
    changed = true;
  }
  return changed ? `${JSON.stringify(packageLock, null, 2)}\n` : args.source;
}
