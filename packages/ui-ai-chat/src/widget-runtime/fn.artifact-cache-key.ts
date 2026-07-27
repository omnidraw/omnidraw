import type { TWidgetRuntimeIdentity } from './interface';

function encodePart(value: string): string {
  return `${value.length}:${value}`;
}

export function fnWidgetUiArtifactCacheKey(args: Readonly<{
  identity: Pick<TWidgetRuntimeIdentity, 'orgId' | 'definitionId' | 'revisionId'>;
  tenantAuthorityKey: string;
  digestSha256: string;
  capsuleArtifactHash: string;
}>): string {
  return [
    args.identity.orgId,
    args.tenantAuthorityKey,
    args.identity.definitionId,
    args.identity.revisionId,
    args.digestSha256,
    args.capsuleArtifactHash,
  ].map(encodePart).join('|');
}
