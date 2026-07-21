import type { TNotificationEvent } from '@vibecanvas/api/notification/contract';
import type { TWidgetExecutableProbe } from './fx.probe-widget-executable';

export type TWidgetPrerequisiteWarning = {
  cliMessage: string;
  notification: TNotificationEvent;
};

export function fnWidgetPrerequisiteWarning(probes: readonly TWidgetExecutableProbe[]): TWidgetPrerequisiteWarning | null {
  const unavailable = probes.filter((probe) => probe.status !== 'available');
  if (unavailable.length === 0) return null;

  const unavailableSummary = unavailable
    .map((probe) => `${probe.executable === 'node' ? 'Node.js' : 'npm'} (${probe.status})`)
    .join(', ');
  const title = 'Widget tooling prerequisites unavailable';
  const description = `Unavailable: ${unavailableSummary}. Widget creation, dependency installation, build, and validation require Node.js and npm. Install them from https://nodejs.org/ and restart Vibecanvas.`;

  return {
    cliMessage: `Warning: ${title}. ${description}`,
    notification: { type: 'warning', title, description },
  };
}
