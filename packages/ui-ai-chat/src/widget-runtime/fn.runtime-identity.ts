import type { TElement } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import type {
  TWidgetRuntimeIdentity,
  TWidgetRuntimeLoadRequest,
  TWidgetRuntimeLocalTarget,
} from './interface';

export function fnWidgetRuntimeLoadRequest(args: Readonly<{
  canvasId: string;
  elementId: string;
  definitionId: string;
  revisionId: string;
  widgetInstanceId: string;
}>): TWidgetRuntimeLoadRequest {
  return {
    canvasId: args.canvasId,
    elementId: args.elementId,
    widgetInstanceId: args.widgetInstanceId,
    definitionId: args.definitionId,
    revisionId: args.revisionId,
  };
}

export function fnWidgetRuntimeIdentityMatches(
  identity: TWidgetRuntimeIdentity,
  request: TWidgetRuntimeLoadRequest,
): boolean {
  return identity.orgId.length > 0
    && identity.canvasId === request.canvasId
    && identity.elementId === request.elementId
    && identity.widgetInstanceId === request.widgetInstanceId
    && identity.definitionId === request.definitionId
    && identity.revisionId === request.revisionId;
}

export function fnWidgetRuntimeLocalTarget(args: Readonly<{
  canvasId: string;
  element: TElement;
}>): TWidgetRuntimeLocalTarget {
  if (args.element.data.type !== 'widget-instance') {
    throw new TypeError('The neutral widget runtime requires widget-instance element data.');
  }
  return {
    canvasId: args.canvasId,
    elementId: args.element.id,
    widgetInstanceId: args.element.data.instanceId,
    definitionId: args.element.data.definitionId,
    revisionId: args.element.data.revisionId,
    stateDocumentId: args.element.data.stateDocumentId ?? null,
  };
}

export function fnWidgetRuntimeLocalTargetMatchesElement(
  target: TWidgetRuntimeLocalTarget,
  element: TElement | undefined,
): boolean {
  return element?.id === target.elementId
    && element.data.type === 'widget-instance'
    && element.data.instanceId === target.widgetInstanceId
    && element.data.definitionId === target.definitionId
    && element.data.revisionId === target.revisionId
    && (element.data.stateDocumentId ?? null) === target.stateDocumentId;
}
