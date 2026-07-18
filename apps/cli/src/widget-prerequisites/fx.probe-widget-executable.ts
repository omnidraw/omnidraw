export type TWidgetExecutable = 'node' | 'npm';

export type TWidgetExecutableProbe =
  | { executable: TWidgetExecutable; status: 'available'; version: string }
  | { executable: TWidgetExecutable; status: 'missing' | 'unusable' };

export type TExecFileError = Error & { code?: string | number | null };

export type TExecFile = (
  file: string,
  args: readonly string[],
  options: { timeout: number; windowsHide: true },
  callback: (error: TExecFileError | null, stdout: unknown, stderr: unknown) => void,
) => void;

type TPortal = {
  execFile: TExecFile;
};

type TArgs = {
  executable: TWidgetExecutable;
  timeoutMs: number;
};

export function fxProbeWidgetExecutable(portal: TPortal, args: TArgs): Promise<TWidgetExecutableProbe> {
  return new Promise((resolve) => {
    const finish = (probe: TWidgetExecutableProbe) => resolve(probe);

    try {
      portal.execFile(args.executable, ['--version'], {
        timeout: args.timeoutMs,
        windowsHide: true,
      }, (error, stdout) => {
        if (error) {
          finish({
            executable: args.executable,
            status: error.code === 'ENOENT' ? 'missing' : 'unusable',
          });
          return;
        }

        const version = typeof stdout === 'string' ? stdout.trim() : String(stdout ?? '').trim();
        finish(version
          ? { executable: args.executable, status: 'available', version }
          : { executable: args.executable, status: 'unusable' });
      });
    } catch {
      finish({ executable: args.executable, status: 'unusable' });
    }
  });
}
