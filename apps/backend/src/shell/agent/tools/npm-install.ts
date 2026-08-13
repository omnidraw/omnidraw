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

type TEffects = {
  access: (path: string) => Promise<void>;
  execFile: TExecFile;
  join: (...paths: string[]) => string;
};

type TArgs = {
  cwd: string;
  userConfigPath?: string;
};

type TEffectsRestorePackageLock = {
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  rename: (source: string, destination: string) => Promise<void>;
  rm: (path: string, options: { force: true }) => Promise<void>;
};

type TArgsRestorePackageLock = {
  state: TNpmPackageLockState;
};

export async function tryNpmInstall(effects: TEffects, args: TArgs): Promise<TNpmInstallResult> {
  try {
    await effects.access(effects.join(args.cwd, 'package.json'));
  } catch {
    return { status: 'skipped', reason: 'package.json does not exist' };
  }

  return new Promise((resolve) => {
    const commandArgs = [
      'install',
      ...(args.userConfigPath === undefined ? [] : ['--userconfig', args.userConfigPath]),
    ];
    effects.execFile('npm', commandArgs, { cwd: args.cwd, timeout: 120_000 }, (error, stdout, stderr) => {
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

export async function restoreNpmPackageLock(
  effects: TEffectsRestorePackageLock,
  args: TArgsRestorePackageLock,
): Promise<void> {
  if (args.state.bytes === null) {
    await effects.rm(args.state.path, { force: true });
    return;
  }
  const temporaryPath = `${args.state.path}.rollback.tmp`;
  await effects.rm(temporaryPath, { force: true });
  try {
    await effects.writeFile(temporaryPath, args.state.bytes);
    await effects.rename(temporaryPath, args.state.path);
  } finally {
    await effects.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
