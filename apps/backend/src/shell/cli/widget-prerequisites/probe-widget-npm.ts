import type {
  TExecFile,
  TWidgetPrerequisiteProbe,
} from './interface';

type TEffects = {
  execFile: TExecFile;
};

type TArgs = {
  timeoutMs: number;
};

export function probeWidgetNpm(
  effects: TEffects,
  args: TArgs,
): Promise<TWidgetPrerequisiteProbe> {
  return new Promise((resolve) => {
    try {
      effects.execFile('npm', ['--version'], {
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
