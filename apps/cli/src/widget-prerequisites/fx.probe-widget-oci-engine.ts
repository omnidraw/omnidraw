import type {
  TWidgetCapsuleOciEngineSelection,
} from '../services/widget-capsule-oci/fn.engine-selection';
import type {
  TExecFile,
  TReadFileSha256,
  TWidgetOciEngineProbe,
} from './interface';

type TPortal = {
  execFile: TExecFile;
  readFileSha256: TReadFileSha256;
};

type TArgs = TWidgetCapsuleOciEngineSelection & {
  imageId: string;
  timeoutMs: number;
};

export function fxProbeWidgetOciEngine(
  portal: TPortal,
  args: TArgs,
): Promise<TWidgetOciEngineProbe> {
  const unavailable = (
    status: Extract<TWidgetOciEngineProbe['status'], 'missing' | 'unusable'>,
  ): TWidgetOciEngineProbe => ({
    subject: 'engine',
    engine: args.engine,
    enginePath: args.enginePath,
    status,
  });

  return portal.readFileSha256(args.enginePath).then((actualSha256) => {
    if (actualSha256 !== args.engineSha256) return unavailable('unusable');

    return new Promise<TWidgetOciEngineProbe>((resolve) => {
      const finish = (probe: TWidgetOciEngineProbe) => resolve(probe);

      try {
        portal.execFile(args.enginePath, ['--version'], {
          timeout: args.timeoutMs,
          windowsHide: true,
        }, (error, stdout) => {
          if (error) {
            finish(unavailable(error.code === 'ENOENT' ? 'missing' : 'unusable'));
            return;
          }

          const version = typeof stdout === 'string'
            ? stdout.trim()
            : String(stdout ?? '').trim();
          if (!version) {
            finish(unavailable('unusable'));
            return;
          }
          try {
            portal.execFile(args.enginePath, [
              'image',
              'inspect',
              '--format={{.Id}}',
              args.imageId,
            ], {
              timeout: args.timeoutMs,
              windowsHide: true,
            }, (imageError, imageStdout) => {
              const imageId = typeof imageStdout === 'string'
                ? imageStdout.trim()
                : String(imageStdout ?? '').trim();
              if (imageError || imageId !== args.imageId) {
                finish(unavailable('unusable'));
                return;
              }
              finish({
                subject: 'engine',
                engine: args.engine,
                enginePath: args.enginePath,
                status: 'available',
                version,
              });
            });
          } catch {
            finish(unavailable('unusable'));
          }
        });
      } catch {
        finish(unavailable('unusable'));
      }
    });
  }, (digestError: unknown) => {
    const code = (
      digestError !== null
      && typeof digestError === 'object'
      && 'code' in digestError
    ) ? digestError.code : undefined;
    return unavailable(code === 'ENOENT' ? 'missing' : 'unusable');
  });
}
