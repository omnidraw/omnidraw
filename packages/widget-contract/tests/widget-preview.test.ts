import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  fnCanonicalizeWidgetContractPayload,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  type IWidgetArtifactBuilder,
  type TWidgetBuildResult,
  type TWidgetManifestV2,
  type TWidgetSourceSnapshot,
} from '../src';
import { WidgetPreviewService } from '../src/local';

const tenant: TTenantContext = Object.freeze({
  orgId: 'org-preview', accountId: 'account-preview', cellId: 'cell-preview',
  placementEpoch: 1, roles: ['owner'], capabilities: ['*'], requestId: 'request-preview',
});
const manifest: TWidgetManifestV2 = Object.freeze({
  schemaVersion: 2, name: 'Preview widget', slug: 'preview-widget',
  ui: Object.freeze({ entry: 'src/ui.ts' }),
});
const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const bytes = new TextEncoder().encode('export const ui = true;');
const snapshot: TWidgetSourceSnapshot = Object.freeze({
  id: 'source-ui', digestSha256: sha256(`14:src/ui.ts:${bytes.byteLength}:export const ui = true;;`),
  files: Object.freeze([Object.freeze({ path: 'src/ui.ts', bytes })]), createdAtMs: 1,
});

function builder(): IWidgetArtifactBuilder {
  return {
    async build(_tenant, request): Promise<TWidgetBuildResult> {
      const uiBytes = new TextEncoder().encode(`ui:${request.snapshot.digestSha256}`);
      const uiArtifact = { kind: 'ui' as const, digestSha256: sha256(uiBytes), bytes: uiBytes };
      const functionDescriptors = Object.freeze([]);
      const functionDescriptorsDigestSha256 = sha256(
        fnCanonicalizeWidgetServerFunctionDescriptors(functionDescriptors),
      );
      return Object.freeze({
        sourceSnapshotId: request.snapshot.id,
        sourceDigestSha256: request.snapshot.digestSha256,
        builderIdentity: request.builderIdentity,
        canonicalManifestJson: request.canonicalManifestJson,
        functionDescriptors,
        functionDescriptorsDigestSha256,
        contractDigestSha256: sha256(fnCanonicalizeWidgetContractPayload({
          canonicalManifestJson: request.canonicalManifestJson,
          uiDigestSha256: uiArtifact.digestSha256,
          serverDigestSha256: null,
          runtimeAbi: null,
          functionDescriptorsDigestSha256,
        })),
        uiArtifact,
        serverArtifact: null,
      });
    },
  };
}

describe('stateless widget preview', () => {
  test('returns verified UI bytes without an artifact or metadata store', async () => {
    const result = await new WidgetPreviewService({ builder: builder() }).buildPreview(tenant, {
      draftId: 'draft-ui', definitionId: 'definition-ui',
      draftRevisionSha256: snapshot.digestSha256, snapshot, manifest,
      builderIdentity: 'preview-builder-v1',
    });
    expect(result.draftRevisionSha256).toBe(snapshot.digestSha256);
    expect(new TextDecoder().decode(result.uiArtifact.bytes)).toBe(`ui:${snapshot.digestSha256}`);
  });

  test('rejects a mismatched current-draft digest before building', async () => {
    await expect(new WidgetPreviewService({ builder: builder() }).buildPreview(tenant, {
      draftId: 'draft-ui', definitionId: 'definition-ui',
      draftRevisionSha256: 'c'.repeat(64), snapshot, manifest,
      builderIdentity: 'preview-builder-v1',
    })).rejects.toMatchObject({ code: 'WIDGET_PREVIEW_DRAFT_STALE' });
  });
});
