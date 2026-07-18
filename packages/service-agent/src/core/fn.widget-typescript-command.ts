import { WIDGET_TYPESCRIPT_VERSION } from './CONSTANTS';

export type TWidgetTypescriptCommand = {
  file: string;
  args: string[];
};

export function fnWidgetTypescriptCommand(configPath: string): TWidgetTypescriptCommand {
  return {
    file: 'npm',
    args: [
      'exec',
      '--yes',
      `--package=typescript@${WIDGET_TYPESCRIPT_VERSION}`,
      '--',
      'tsc',
      '--pretty',
      'false',
      '--noEmit',
      '-p',
      configPath,
    ],
  };
}
