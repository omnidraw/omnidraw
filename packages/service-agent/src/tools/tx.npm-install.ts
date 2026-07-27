export type TNpmInstallResult =
  | { status: 'skipped'; reason: string }
  | { status: 'success'; stdout: string; stderr: string }
  | { status: 'error'; message: string; stdout: string; stderr: string };

export type TNpmInstall = (cwd: string) => Promise<TNpmInstallResult>;

export type TNpmPackageLockState = Readonly<{
  path: string;
  bytes: Uint8Array | null;
}>;

type TExecFile = (
  file: string,
  args: readonly string[],
  options: { cwd: string; timeout: number },
  callback: (error: Error | null, stdout: unknown, stderr: unknown) => void,
) => void;

type TPortal = {
  access: (path: string) => Promise<void>;
  execFile: TExecFile;
  join: (...paths: string[]) => string;
};

type TArgs = {
  cwd: string;
};

type TPortalRestorePackageLock = {
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  rename: (source: string, destination: string) => Promise<void>;
  rm: (path: string, options: { force: true }) => Promise<void>;
};

type TArgsRestorePackageLock = {
  state: TNpmPackageLockState;
};

export async function txTryNpmInstall(portal: TPortal, args: TArgs): Promise<TNpmInstallResult> {
  try {
    await portal.access(portal.join(args.cwd, 'package.json'));
  } catch {
    return { status: 'skipped', reason: 'package.json does not exist' };
  }

  return new Promise((resolve) => {
    portal.execFile('npm', ['install'], { cwd: args.cwd, timeout: 120_000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          status: 'error',
          message: error.message,
          stdout: String(stdout),
          stderr: String(stderr),
        });
        return;
      }

      resolve({
        status: 'success',
        stdout: String(stdout),
        stderr: String(stderr),
      });
    });
  });
}

export async function txRestoreNpmPackageLock(
  portal: TPortalRestorePackageLock,
  args: TArgsRestorePackageLock,
): Promise<void> {
  if (args.state.bytes === null) {
    await portal.rm(args.state.path, { force: true });
    return;
  }
  const temporaryPath = `${args.state.path}.rollback.tmp`;
  await portal.rm(temporaryPath, { force: true });
  try {
    await portal.writeFile(temporaryPath, args.state.bytes);
    await portal.rename(temporaryPath, args.state.path);
  } finally {
    await portal.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
