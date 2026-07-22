import type { TWidgetInstanceMetadataProjectionSnapshot } from './WidgetInstanceMetadataStoreTurso';

const LOWERCASE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function fnValidateWidgetInstanceMetadataProjectionSnapshot(
  snapshot: TWidgetInstanceMetadataProjectionSnapshot,
  isCanonicalStateDocumentId: (candidate: unknown) => boolean,
): void {
  if (!LOWERCASE_UUID_PATTERN.test(snapshot.canvasId)) {
    throw new TypeError('Widget instance projection canvas id must be a lowercase UUID.');
  }
  if (!Number.isSafeInteger(snapshot.sourceSequence) || snapshot.sourceSequence < 0) {
    throw new RangeError('Widget instance source sequence must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(snapshot.projectedAtMs) || snapshot.projectedAtMs < 0) {
    throw new RangeError('Widget instance projection time must be a non-negative safe integer.');
  }
  const instanceIds = new Set<string>();
  const elementIds = new Set<string>();
  for (const instance of snapshot.instances) {
    if (
      !LOWERCASE_UUID_PATTERN.test(instance.instanceId)
      || !LOWERCASE_UUID_PATTERN.test(instance.definitionId)
      || !LOWERCASE_UUID_PATTERN.test(instance.revisionId)
    ) {
      throw new TypeError('Widget instance projection identities must be lowercase UUIDs.');
    }
    if (
      instance.elementId.trim() !== instance.elementId
      || instance.elementId.length < 1
      || instance.elementId.length > 200
    ) {
      throw new TypeError('Widget instance projection element id must contain 1 to 200 trimmed characters.');
    }
    if (
      instance.stateDocumentId !== null
      && (
        !instance.stateDocumentId.startsWith('automerge:')
        || instance.stateDocumentId.includes('#')
        || instance.stateDocumentId.trim() !== instance.stateDocumentId
        || instance.stateDocumentId.length > 500
        || !isCanonicalStateDocumentId(instance.stateDocumentId)
      )
    ) {
      throw new TypeError('Widget instance projection state document id is invalid.');
    }
    if (instanceIds.has(instance.instanceId) || elementIds.has(instance.elementId)) {
      throw new TypeError('Widget instance projection contains a duplicate instance or element identity.');
    }
    instanceIds.add(instance.instanceId);
    elementIds.add(instance.elementId);
  }
}

export function fnNextWidgetInstanceProjectionTimestamp(
  requestedAtMs: number,
  previousValues: readonly number[],
): number {
  const projectedAtMs = Math.max(requestedAtMs, Math.max(...previousValues) + 1);
  if (!Number.isSafeInteger(projectedAtMs)) {
    throw new RangeError('Widget instance projection timestamp exceeded the safe integer range.');
  }
  return projectedAtMs;
}
