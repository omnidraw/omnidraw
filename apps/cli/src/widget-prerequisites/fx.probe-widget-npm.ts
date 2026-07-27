import type {
  TExecFile,
  TWidgetPrerequisiteProbe,
} from './interface';

type TPortal = {
  execFile: TExecFile;
};

type TArgs = {
  timeoutMs: number;
};

export function fxProbeWidgetNpm(
  portal: TPortal,
  args: TArgs,
): Promise<TWidgetPrerequisiteProbe> {
  return new Promise((resolve) => {
    try {
      portal.execFile('npm', ['--version'], {
        timeout: args.timeoutMs,
        windowsHide: true,
      }, (error, stdout) => {
        if (error) {
          resolve({
            subject: 'npm',
            status: error.code === 'ENOENT' ? 'missing' : 'unusable',
          });
          return;
        }
        const version = String(stdout ?? '').trim();
        resolve(version === ''
          ? { subject: 'npm', status: 'unusable' }
          : { subject: 'npm', status: 'available', version });
      });
    } catch {
      resolve({ subject: 'npm', status: 'unusable' });
    }
  });
}
