import {
  MAX_WIDGET_STATE_ID_LENGTH,
  WIDGET_STATE_INITIAL_VERSION,
} from './CONSTANTS';
import { fnNormalizeWidgetStateJson } from './fn.widget-state-json';
import type {
  TWidgetStateInstanceIdentity,
  TWidgetStateSnapshot,
  TWidgetStateStoredSnapshot,
} from './types';

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > MAX_WIDGET_STATE_ID_LENGTH
    || value.trim() !== value
  ) {
    throw new TypeError(`${label} must contain 1 to ${MAX_WIDGET_STATE_ID_LENGTH} trimmed characters.`);
  }
}

export function fnNormalizeWidgetStateIdentity(
  value: TWidgetStateInstanceIdentity,
): TWidgetStateInstanceIdentity {
  assertIdentifier(value.orgId, 'Widget state organization id');
  assertIdentifier(value.canvasId, 'Widget state canvas id');
  assertIdentifier(value.elementId, 'Widget state element id');
  assertIdentifier(value.widgetInstanceId, 'Widget state instance id');
  assertIdentifier(value.definitionId, 'Widget state definition id');
  assertIdentifier(value.revisionId, 'Widget state revision id');
  return Object.freeze({
    orgId: value.orgId,
    canvasId: value.canvasId,
    elementId: value.elementId,
    widgetInstanceId: value.widgetInstanceId,
    definitionId: value.definitionId,
    revisionId: value.revisionId,
  });
}

export function fnAssertWidgetStateVersion(
  version: number,
  minimum = WIDGET_STATE_INITIAL_VERSION,
): void {
  if (!Number.isSafeInteger(version) || version < minimum) {
    throw new TypeError(`Widget state version must be a safe integer greater than or equal to ${minimum}.`);
  }
}

export function fnAssertWidgetStateCursor(afterVersion: number): void {
  if (!Number.isSafeInteger(afterVersion) || afterVersion < 0) {
    throw new TypeError('Widget state subscription cursor must be a nonnegative safe integer.');
  }
}

export function fnCreateWidgetStateSnapshot(
  identity: TWidgetStateInstanceIdentity,
  stored: TWidgetStateStoredSnapshot,
): TWidgetStateSnapshot {
  fnAssertWidgetStateVersion(stored.version);
  return Object.freeze({
    identity,
    version: stored.version,
    state: fnNormalizeWidgetStateJson(stored.state),
  });
}

export function fnWidgetStateSnapshotsMatch(
  left: TWidgetStateSnapshot,
  right: TWidgetStateSnapshot,
): boolean {
  return left.version === right.version
    && left.identity.orgId === right.identity.orgId
    && left.identity.canvasId === right.identity.canvasId
    && left.identity.elementId === right.identity.elementId
    && left.identity.widgetInstanceId === right.identity.widgetInstanceId
    && left.identity.definitionId === right.identity.definitionId
    && left.identity.revisionId === right.identity.revisionId
    && JSON.stringify(left.state) === JSON.stringify(right.state);
}
