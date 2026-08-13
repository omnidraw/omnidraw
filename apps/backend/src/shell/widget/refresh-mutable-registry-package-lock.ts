import { fnMutableRegistryPackageLock } from './fn.mutable-registry-package-lock';

type TEffects = Readonly<{
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
export async function refreshMutableRegistryPackageLock(
  effects: TEffects,
  args: TArgs,
): Promise<void> {
  const path = effects.join(args.root, 'package-lock.json');
  const source = await effects.readFile(path, 'utf8');
  const refreshed = fnMutableRegistryPackageLock({
    source,
    registryUrl: args.registryUrl,
  });
  if (refreshed !== source) {
    await effects.writeFile(path, refreshed, { mode: 0o600 });
  }
}
