export type TNpmInstallResult =
  | { status: 'skipped'; reason: string }
  | { status: 'success'; stdout: string; stderr: string }
  | { status: 'error'; message: string; stdout: string; stderr: string };

export type TNpmInstall = (cwd: string) => Promise<TNpmInstallResult>;

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

