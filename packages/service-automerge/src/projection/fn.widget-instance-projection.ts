import type {
  TWidgetInstanceProjectionRecord,
  TWidgetInstanceProjectionSnapshot,
  TWidgetInstanceProjectionSource,
} from './interface';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function requiredUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase UUID.`);
  }
  return value;
}

function requiredElementId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > 200) {
    throw new TypeError('Widget instance element id must contain 1 to 200 trimmed characters.');
  }
  return value;
}

function optionalStateDocumentId(
  value: unknown,
  isValidStateDocumentId: (candidate: unknown) => boolean,
): string | null {
  if (value === undefined) return null;
  if (
    typeof value !== 'string'
    || value.includes('#')
    || !isValidStateDocumentId(value)
  ) {
    throw new TypeError('Widget state document id must be a canonical Automerge document URL without heads.');
  }
  return value;
}

export function fnWidgetInstanceProjectionSnapshot(
  source: TWidgetInstanceProjectionSource,
  projectedAtMs: number,
  isValidStateDocumentId: (candidate: unknown) => boolean,
): TWidgetInstanceProjectionSnapshot {
  const canvasId = requiredUuid(source.canvasId, 'Canvas id');
  if (!Number.isSafeInteger(projectedAtMs) || projectedAtMs < 0) {
    throw new RangeError('Widget instance projection time must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(source.sourceSequence) || source.sourceSequence < 0) {
    throw new RangeError('Widget instance source sequence must be a non-negative safe integer.');
  }

  const instanceIds = new Set<string>();
  const records: TWidgetInstanceProjectionRecord[] = [];
  for (const [elementKey, element] of Object.entries(source.elements)) {
    if (element.data.type !== 'widget-instance') continue;
    const elementId = requiredElementId(element.id);
    if (elementKey !== elementId) {
      throw new TypeError('Widget instance element key must match its persisted element id.');
    }
    const instanceId = requiredUuid(element.data.instanceId, 'Widget instance id');
    if (instanceIds.has(instanceId)) {
      throw new TypeError(`Widget instance id '${instanceId}' appears more than once in the canvas.`);
    }
    instanceIds.add(instanceId);
    records.push(Object.freeze({
      instanceId,
      elementId,
      definitionId: requiredUuid(element.data.definitionId, 'Widget definition id'),
      revisionId: requiredUuid(element.data.revisionId, 'Widget revision id'),
      stateDocumentId: optionalStateDocumentId(
        element.data.stateDocumentId,
        isValidStateDocumentId,
      ),
    }));
  }
  records.sort((left, right) => (
    left.elementId.localeCompare(right.elementId)
    || left.instanceId.localeCompare(right.instanceId)
  ));
  return Object.freeze({
    canvasId,
    sourceSequence: source.sourceSequence,
    projectedAtMs,
    instances: Object.freeze(records),
  });
}

export function fnWidgetInstanceProjectionContentIdentity(
  snapshot: TWidgetInstanceProjectionSnapshot,
): string {
  return JSON.stringify({
    canvasId: snapshot.canvasId,
    sourceSequence: snapshot.sourceSequence,
    instances: snapshot.instances,
  });
}
