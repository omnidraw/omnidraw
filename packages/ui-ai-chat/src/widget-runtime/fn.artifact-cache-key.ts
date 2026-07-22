import type { TWidgetRuntimeIdentity } from './interface';

function encodePart(value: string): string {
  return `${value.length}:${value}`;
}

export function fnWidgetUiArtifactCacheKey(args: Readonly<{
  identity: Pick<TWidgetRuntimeIdentity, 'orgId' | 'definitionId' | 'revisionId'>;
  digestSha256: string;
}>): string {
  return [
    args.identity.orgId,
    args.identity.definitionId,
    args.identity.revisionId,
    args.digestSha256,
  ].map(encodePart).join('|');
}
