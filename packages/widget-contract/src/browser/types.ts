/** @file Browser-only immutable UI artifact envelope types. */

import type { TWidgetArtifactDigest } from '../types';

export type TWidgetUiArtifactOutputLoader = 'js' | 'css' | 'json' | 'wasm' | 'file';
export type TWidgetUiArtifactOutputKind = 'entry-point' | 'chunk' | 'asset';

export type TWidgetUiArtifactOutput = Readonly<{
  path: string;
  loader: TWidgetUiArtifactOutputLoader;
  kind: TWidgetUiArtifactOutputKind;
  digestSha256: TWidgetArtifactDigest;
  bytesBase64: string;
}>;

export type TWidgetUiArtifactEnvelopeV1 = Readonly<{
  format: 'vibecanvas.widget-artifact.v1';
  kind: 'ui';
  entry: string;
  sourceDigestSha256: TWidgetArtifactDigest;
  builderIdentity: string;
  runtimeAbi: null;
  outputs: readonly TWidgetUiArtifactOutput[];
}>;
