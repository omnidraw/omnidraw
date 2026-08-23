import type { TNotificationEvent } from '#backend/shell/api/notification/contract';
import type { ICliConfig } from '../config';
import { probeWidgetNpm } from './probe-widget-npm';
import type { TWidgetPrerequisiteWarning } from './fn.widget-prerequisite-warning';
import { fnWidgetPrerequisiteWarning } from './fn.widget-prerequisite-warning';
import type {
  TExecFile,
  TWidgetPrerequisiteProbe,
} from './interface';

type TEffects = {
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
  effects: Pick<TEffects, 'publishNotification' | 'warn'>,
  warning: TWidgetPrerequisiteWarning | null,
): void {
  if (warning === null) return;
  try {
    effects.warn(warning.cliMessage);
  } catch {
    // Startup warnings are best-effort and must never prevent server loading.
  }
  try {
    effects.publishNotification(warning.notification);
  } catch {
    // The CLI warning remains useful if notification delivery is unavailable.
  }
}

export async function checkWidgetPrerequisites(
  effects: TEffects,
  args: TArgs,
): Promise<TWidgetPrerequisiteCheck> {
  if (args.command !== 'serve' || args.helpRequested || args.versionRequested) {
    return { checked: false, probes: [], warning: null };
  }
  try {
    const probes = [await probeWidgetNpm(effects, {
      timeoutMs: args.timeoutMs ?? 3_000,
    })];
    const warning = fnWidgetPrerequisiteWarning(probes);
    publishWarning(effects, warning);
    return { checked: true, probes, warning };
  } catch {
    return { checked: true, probes: [], warning: null };
  }
}
