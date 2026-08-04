import type { TWidgetRuntimeIdentity } from './interface';

function encodePart(value: string): string {
  return `${value.length}:${value}`;
}

export function fnWidgetUiArtifactCacheKey(args: Readonly<{
  identity: Pick<TWidgetRuntimeIdentity, 'orgId' | 'widgetKey' | 'catalogGeneration'>;
  tenantAuthorityKey: string;
  digestSha256: string;
  capsuleArtifactHash: string;
}>): string {
  return [
    args.identity.orgId,
    args.tenantAuthorityKey,
    args.identity.widgetKey,
    String(args.identity.catalogGeneration),
    args.digestSha256,
    args.capsuleArtifactHash,
  ].map(encodePart).join('|');
}
