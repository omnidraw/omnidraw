import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  TWidgetArtifactKind,
  TWidgetArtifactReadPurpose,
} from '../types';

const MAX_WIDGET_ARTIFACT_CAPABILITY_CONTEXT_LENGTH = 200;

/** Derives an audience from trusted tenant placement rather than caller input. */
export function fnWidgetArtifactAudience(
  tenant: TTenantContext,
  purpose: TWidgetArtifactReadPurpose,
): string {
  if (purpose === 'browser_ui' || purpose === 'source_map') {
    return `account:${tenant.orgId}:${tenant.accountId}:${purpose}`;
  }
  return `cell:${tenant.orgId}:${tenant.cellId}:${tenant.placementEpoch}:${purpose}`;
}

/** Bounds caller-controlled capability context before signing or verification. */
export function fnWidgetArtifactCapabilityContextIsValid(value: string): boolean {
  return value.length >= 1
    && value.length <= MAX_WIDGET_ARTIFACT_CAPABILITY_CONTEXT_LENGTH
    && value === value.trim();
}

/** Purpose-to-kind policy enforced both before signing and after verification. */
export function fnWidgetArtifactPurposeAllowsKind(
  purpose: TWidgetArtifactReadPurpose,
  kind: TWidgetArtifactKind,
): boolean {
  if (purpose === 'cell_move') return true;
  if (purpose === 'browser_ui') return kind === 'ui';
  if (purpose === 'server_execution') return kind === 'server';
  if (purpose === 'source_build') return kind === 'source';
  if (purpose === 'preview_construction') {
    return kind === 'source' || kind === 'unsigned_ui' || kind === 'server';
  }
  return purpose === 'source_map' && kind === 'source_map';
}
