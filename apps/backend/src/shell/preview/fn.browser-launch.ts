import type { LaunchOptions } from 'playwright';
import { PREVIEW_INSPECTION_BROWSER_LAUNCH_ARGS } from './CONSTANTS';

type TArgs = Readonly<{
  downloadsPath: string;
  executablePath: string;
  timeoutMs: number;
}>;

export function fnPreviewInspectionChromiumLaunchOptions(
  args: TArgs,
): LaunchOptions {
  return {
    headless: true,
    chromiumSandbox: true,
    downloadsPath: args.downloadsPath,
    executablePath: args.executablePath,
    timeout: args.timeoutMs,
    args: [...PREVIEW_INSPECTION_BROWSER_LAUNCH_ARGS],
  };
}
