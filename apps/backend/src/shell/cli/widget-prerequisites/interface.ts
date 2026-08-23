export type TWidgetPrerequisiteProbe = Readonly<{
  subject: 'npm';
  status: 'available';
  version: string;
}> | Readonly<{
  subject: 'npm';
  status: 'missing' | 'unusable';
}>;

export type TExecFileError = Error & { code?: string | number | null };

export type TExecFile = (
  file: string,
  args: readonly string[],
  options: { timeout: number; windowsHide: true },
  callback: (error: TExecFileError | null, stdout: unknown, stderr: unknown) => void,
) => void;
