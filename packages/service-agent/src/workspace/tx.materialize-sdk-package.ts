import { SDK_PACKAGE_ASSETS, SDK_PACKAGE_JSON } from './CONSTANTS';

type TPortal = {
  readFile: (path: string) => Promise<Buffer>;
  writeFile: (path: string, content: string | Uint8Array) => Promise<void>;
  mkdir: (path: string, options: { recursive: true }) => Promise<string | undefined>;
  lstat: (path: string) => Promise<unknown>;
  rename: (source: string, destination: string) => Promise<void>;
  rm: (path: string, options: { recursive: true; force: true }) => Promise<void>;
  join: (...paths: string[]) => string;
  dirname: (path: string) => string;
  createId: () => string;
};

type TArgs = {
  targetPath: string;
};

export async function txMaterializeSdkPackage(portal: TPortal, args: TArgs): Promise<void> {
  const suffix = portal.createId().replace(/[^a-zA-Z0-9_-]/g, '');
  const temporaryPath = `${args.targetPath}.materialize-${suffix}`;
  const backupPath = `${args.targetPath}.backup-${suffix}`;
  let movedExisting = false;
  let promoted = false;

  try {
    await portal.rm(temporaryPath, { recursive: true, force: true });
    await portal.mkdir(temporaryPath, { recursive: true });
    await portal.writeFile(portal.join(temporaryPath, 'package.json'), SDK_PACKAGE_JSON);
    for (const asset of SDK_PACKAGE_ASSETS) {
      const destination = portal.join(temporaryPath, asset.relativePath);
      await portal.mkdir(portal.dirname(destination), { recursive: true });
      await portal.writeFile(destination, await portal.readFile(asset.sourcePath));
    }

    if (await portal.lstat(args.targetPath).catch(() => null)) {
      await portal.rename(args.targetPath, backupPath);
      movedExisting = true;
    }
    try {
      await portal.rename(temporaryPath, args.targetPath);
      promoted = true;
    } catch (error) {
      if (movedExisting && !await portal.lstat(args.targetPath).catch(() => null)) {
        await portal.rename(backupPath, args.targetPath);
        movedExisting = false;
      }
      throw error;
    }
    if (movedExisting) {
      await portal.rm(backupPath, { recursive: true, force: true });
      movedExisting = false;
    }
  } finally {
    if (!promoted) await portal.rm(temporaryPath, { recursive: true, force: true }).catch(() => undefined);
    if (!movedExisting) await portal.rm(backupPath, { recursive: true, force: true }).catch(() => undefined);
  }
}
