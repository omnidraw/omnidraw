import type {
  TWidgetCapsuleOciEngineSelection,
} from '../services/widget-capsule-oci/fn.engine-selection';

export type TWidgetOciEngineProbe =
  | Readonly<{
    subject: 'engine';
    engine: TWidgetCapsuleOciEngineSelection['engine'];
    enginePath: string;
    status: 'available';
    version: string;
  }>
  | Readonly<{
    subject: 'engine';
    engine: TWidgetCapsuleOciEngineSelection['engine'];
    enginePath: string;
    status: 'missing' | 'unusable';
  }>;

export type TWidgetOciConfigurationProbe = Readonly<{
  subject: 'configuration';
  status: 'unusable';
  reason: string;
}>;

export type TWidgetPrerequisiteProbe =
  | TWidgetOciEngineProbe
  | TWidgetOciConfigurationProbe;

export type TExecFileError = Error & { code?: string | number | null };

export type TExecFile = (
  file: string,
  args: readonly string[],
  options: { timeout: number; windowsHide: true },
  callback: (error: TExecFileError | null, stdout: unknown, stderr: unknown) => void,
) => void;

export type TReadFileSha256 = (
  path: string,
) => Promise<`sha256:${string}`>;
