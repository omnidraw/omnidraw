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
  readFile: (path: string, encoding: 'utf8') => Promise<string>;
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
  const packagePath = effects.join(args.cwd, 'package.json');
  try {
    await effects.access(packagePath);
  } catch {
    return { status: 'skipped', reason: 'package.json does not exist' };
  }

  try {
    const packageJson = JSON.parse(await effects.readFile(packagePath, 'utf8')) as {
      scripts?: Record<string, unknown>;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
      optionalDependencies?: Record<string, unknown>;
      peerDependencies?: Record<string, unknown>;
    };
    const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
    for (const sectionName of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ] as const) {
      for (const [name, specifier] of Object.entries(packageJson[sectionName] ?? {})) {
        if (typeof specifier !== 'string' || !exactVersion.test(specifier)) {
          return {
            status: 'error',
            message: `Dependency '${name}' must use one exact registry version before lock generation.`,
            stdout: '',
            stderr: '',
          };
        }
      }
    }
    for (const scriptName of Object.keys(packageJson.scripts ?? {})) {
      if (scriptName !== 'check' && scriptName !== 'build') {
        return {
          status: 'error',
          message: `Package lifecycle script '${scriptName}' is not allowed in an AI-authored widget.`,
          stdout: '',
          stderr: '',
        };
      }
    }
    if (
      packageJson.scripts?.check !== 'omnidraw-widget check .'
      || packageJson.scripts?.build !== 'omnidraw-widget build .'
    ) {
      return {
        status: 'error',
        message: 'Widget check and build scripts must retain the fixed SDK commands.',
        stdout: '',
        stderr: '',
      };
    }
  } catch (error) {
    return {
      status: 'error',
      message: `package.json could not be validated: ${error instanceof Error ? error.message : String(error)}`,
      stdout: '',
      stderr: '',
    };
  }

  return new Promise((resolve) => {
    const commandArgs = [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
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
