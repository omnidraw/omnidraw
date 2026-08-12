import { fnMutableRegistryPackageLock } from './fn.mutable-registry-package-lock';

type TPortal = Readonly<{
  join: (...paths: string[]) => string;
  readFile: (path: string, encoding: 'utf8') => Promise<string>;
  writeFile: (
    path: string,
    value: string,
    options: Readonly<{ mode: number }>,
  ) => Promise<unknown>;
}>;

type TArgs = Readonly<{
  root: string;
  registryUrl: string;
}>;

/** Rewrites only the private build checkout; authored draft files stay intact. */
export async function txRefreshMutableRegistryPackageLock(
  portal: TPortal,
  args: TArgs,
): Promise<void> {
  const path = portal.join(args.root, 'package-lock.json');
  const source = await portal.readFile(path, 'utf8');
  const refreshed = fnMutableRegistryPackageLock({
    source,
    registryUrl: args.registryUrl,
  });
  if (refreshed !== source) {
    await portal.writeFile(path, refreshed, { mode: 0o600 });
  }
}
