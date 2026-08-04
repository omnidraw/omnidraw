import type { TWidgetRuntimeIdentity } from './interface';

function encodePart(value: string): string {
  return `${value.length}:${value}`;
}

export function fnWidgetUiArtifactCacheKey(args: Readonly<{
  identity: Pick<TWidgetRuntimeIdentity, 'widgetKey' | 'catalogGeneration'>;
  digestSha256: string;
  capsuleArtifactHash: string;
}>): string {
  return [
    args.identity.widgetKey,
    String(args.identity.catalogGeneration),
    args.digestSha256,
    args.capsuleArtifactHash,
  ].map(encodePart).join('|');
}
