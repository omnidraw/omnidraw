import type { TWidgetInstanceData } from '@vibecanvas/service-automerge/types/canvas-doc.types';

export type TWidgetInstanceRuntimeIdentity = Readonly<{
  definitionId: string;
  revisionId: string;
  instanceId: string;
  stateDocumentId: string | null;
}>;

export function fnWidgetInstanceRuntimeIdentity(
  data: TWidgetInstanceData,
): TWidgetInstanceRuntimeIdentity {
  return {
    definitionId: data.definitionId,
    revisionId: data.revisionId,
    instanceId: data.instanceId,
    stateDocumentId: data.stateDocumentId ?? null,
  };
}

export function fnWidgetInstanceRuntimeIdentitiesEqual(
  left: TWidgetInstanceRuntimeIdentity,
  right: TWidgetInstanceRuntimeIdentity,
): boolean {
  return left.definitionId === right.definitionId
    && left.revisionId === right.revisionId
    && left.instanceId === right.instanceId
    && left.stateDocumentId === right.stateDocumentId;
}
