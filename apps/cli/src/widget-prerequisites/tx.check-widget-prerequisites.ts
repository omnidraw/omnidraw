import type { TNotificationEvent } from '@vibecanvas/api/notification/contract';
import type { ICliConfig } from '../config';
import { fxProbeWidgetNpm } from './fx.probe-widget-npm';
import type { TWidgetPrerequisiteWarning } from './fn.widget-prerequisite-warning';
import { fnWidgetPrerequisiteWarning } from './fn.widget-prerequisite-warning';
import type {
  TExecFile,
  TWidgetPrerequisiteProbe,
} from './interface';

type TPortal = {
  execFile: TExecFile;
  warn: (message: string) => void;
  publishNotification: (event: TNotificationEvent) => void;
};

type TArgs = Pick<ICliConfig, 'command' | 'helpRequested' | 'versionRequested'> & {
  timeoutMs?: number;
};

export type TWidgetPrerequisiteCheck = {
  checked: boolean;
  probes: TWidgetPrerequisiteProbe[];
  warning: TWidgetPrerequisiteWarning | null;
};

function publishWarning(
  portal: Pick<TPortal, 'publishNotification' | 'warn'>,
  warning: TWidgetPrerequisiteWarning | null,
): void {
  if (warning === null) return;
  try {
    portal.warn(warning.cliMessage);
  } catch {
    // Startup warnings are best-effort and must never prevent server loading.
  }
  try {
    portal.publishNotification(warning.notification);
  } catch {
    // The CLI warning remains useful if notification delivery is unavailable.
  }
}

export async function txCheckWidgetPrerequisites(
  portal: TPortal,
  args: TArgs,
): Promise<TWidgetPrerequisiteCheck> {
  if (args.command !== 'serve' || args.helpRequested || args.versionRequested) {
    return { checked: false, probes: [], warning: null };
  }
  try {
    const probes = [await fxProbeWidgetNpm(portal, {
      timeoutMs: args.timeoutMs ?? 3_000,
    })];
    const warning = fnWidgetPrerequisiteWarning(probes);
    publishWarning(portal, warning);
    return { checked: true, probes, warning };
  } catch {
    return { checked: true, probes: [], warning: null };
  }
}
