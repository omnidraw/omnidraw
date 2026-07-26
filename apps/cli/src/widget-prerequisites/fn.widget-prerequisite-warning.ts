import type { TNotificationEvent } from '@vibecanvas/api/notification/contract';
import type { TWidgetPrerequisiteProbe } from './interface';

export type TWidgetPrerequisiteWarning = {
  cliMessage: string;
  notification: TNotificationEvent;
};

function unavailableLabel(probe: TWidgetPrerequisiteProbe): string {
  if (probe.subject === 'configuration') {
    return `Capsule OCI engine configuration (${probe.status})`;
  }
  const engine = probe.engine === 'docker' ? 'Docker' : 'Podman';
  return `${engine} OCI engine (${probe.status})`;
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
  const description = `Unavailable: ${unavailableSummary}. Capsule widget creation, build, and validation require the pinned Docker or Podman OCI engine. Configure VIBECANVAS_CAPSULE_OCI_ENGINE, VIBECANVAS_CAPSULE_OCI_ENGINE_PATH, and VIBECANVAS_CAPSULE_OCI_ENGINE_SHA256, ensure the engine daemon is running and the pinned image is loaded, and restart Vibecanvas.`;

  return {
    cliMessage: `Warning: ${title}. ${description}`,
    notification: { type: 'warning', title, description },
  };
}
