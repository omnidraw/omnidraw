/**
 * @file Evaluates v2 widget resource declarations and artifact invariants.
 */

import type { TResourceEffect, TResourceKind } from '@vibecanvas/resource-runtime';
import type { TWidgetManifestV2, TWidgetRevisionDescriptor } from '../types';

type TRequestedEffect = Exclude<TResourceEffect, 'read_write'>;

export function fnWidgetManifestAllowsResource(
  manifest: TWidgetManifestV2,
  args: Readonly<{ slot: string; kind: TResourceKind; effect: TRequestedEffect }>,
): boolean {
  const requirement = manifest.resources?.find((candidate) => candidate.slot === args.slot);
  if (!requirement || requirement.kind !== args.kind) return false;
  return requirement.effect === 'read_write' || requirement.effect === args.effect;
}

export function fnWidgetRevisionArtifactsMatchManifest(
  revision: TWidgetRevisionDescriptor,
): boolean {
  if (revision.uiArtifact.orgId !== revision.orgId || revision.uiArtifact.kind !== 'ui') return false;

  if (revision.manifest.server === undefined) {
    return revision.serverArtifact === null;
  }

  return revision.serverArtifact !== null
    && revision.serverArtifact.orgId === revision.orgId
    && revision.serverArtifact.kind === 'server';
}
