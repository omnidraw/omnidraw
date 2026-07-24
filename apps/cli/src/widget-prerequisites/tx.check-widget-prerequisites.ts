import type { TNotificationEvent } from '@vibecanvas/api/notification/contract';
import type { ICliConfig } from '../config';
import {
  fnWidgetCapsuleOciEngineSelection,
  type TWidgetCapsuleOciEnvironment,
} from '../services/widget-capsule-oci/fn.engine-selection';
import { fxProbeWidgetOciEngine } from './fx.probe-widget-oci-engine';
import type { TWidgetPrerequisiteWarning } from './fn.widget-prerequisite-warning';
import { fnWidgetPrerequisiteWarning } from './fn.widget-prerequisite-warning';
import type {
  TExecFile,
  TReadFileSha256,
  TWidgetPrerequisiteProbe,
} from './interface';

type TPortal = {
  execFile: TExecFile;
  readFileSha256: TReadFileSha256;
  warn: (message: string) => void;
  publishNotification: (event: TNotificationEvent) => void;
};

type TArgs = Pick<ICliConfig, 'command' | 'helpRequested' | 'versionRequested'> & {
  environment: TWidgetCapsuleOciEnvironment;
  platform: NodeJS.Platform;
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
    // Startup warnings are best-effort and must never prevent the server from loading.
  }
  try {
    portal.publishNotification(warning.notification);
  } catch {
    // The CLI warning remains useful if notification delivery is unavailable.
  }
}

export async function txCheckWidgetPrerequisites(portal: TPortal, args: TArgs): Promise<TWidgetPrerequisiteCheck> {
  if (args.command !== 'serve' || args.helpRequested || args.versionRequested) {
    return { checked: false, probes: [], warning: null };
  }

  try {
    const timeoutMs = args.timeoutMs ?? 3_000;
    let selection;
    try {
      selection = fnWidgetCapsuleOciEngineSelection({
        environment: args.environment,
        platform: args.platform,
      });
    } catch (error) {
      const probes: TWidgetPrerequisiteProbe[] = [{
        subject: 'configuration',
        status: 'unusable',
        reason: error instanceof Error
          ? error.message
          : 'Capsule OCI engine configuration is unusable.',
      }];
      const warning = fnWidgetPrerequisiteWarning(probes);
      publishWarning(portal, warning);
      return { checked: true, probes, warning };
    }
    const probes = [await fxProbeWidgetOciEngine(portal, {
      ...selection,
      timeoutMs,
    })];
    const warning = fnWidgetPrerequisiteWarning(probes);
    publishWarning(portal, warning);
    return { checked: true, probes, warning };
  } catch {
    return { checked: true, probes: [], warning: null };
  }
}
