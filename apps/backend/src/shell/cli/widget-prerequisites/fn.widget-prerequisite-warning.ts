import type { TNotificationEvent } from '#backend/shell/api/notification/contract';
import type { TWidgetPrerequisiteProbe } from './interface';

export type TWidgetPrerequisiteWarning = {
  cliMessage: string;
  notification: TNotificationEvent;
};

function unavailableLabel(probe: TWidgetPrerequisiteProbe): string {
  return `npm (${probe.status})`;
}

export function fnWidgetPrerequisiteWarning(
  probes: readonly TWidgetPrerequisiteProbe[],
): TWidgetPrerequisiteWarning | null {
  const unavailable = probes.filter((probe) => probe.status !== 'available');
  if (unavailable.length === 0) return null;

  const unavailableSummary = unavailable
    .map(unavailableLabel)
    .join(', ');
  const title = 'Widget tooling prerequisites unavailable';
  const description = `Unavailable: ${unavailableSummary}. Widget creation, build, and validation require npm with lockfile-v3 and npm-ci support. Install npm on the server account and restart Omnidraw.`;

  return {
    cliMessage: `Warning: ${title}. ${description}`,
    notification: { type: 'warning', title, description },
  };
}
