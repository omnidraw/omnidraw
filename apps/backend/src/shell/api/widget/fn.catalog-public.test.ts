import { describe, expect, test } from 'bun:test';
import type { TWidgetCatalogSnapshot } from '#backend/shell/agent';
import { ZWidgetPublicCatalog } from './contract';
import { fnProjectWidgetPublicCatalog } from './fn.catalog-public';

const SHA = 'a'.repeat(64);

function snapshot(): TWidgetCatalogSnapshot {
  const manifest = {
    $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
    schemaVersion: 1,
    name: 'Notes Board',
    slug: 'notes-board',
    description: 'A bounded catalog fixture.',
    tool: { label: 'Notes', group: 'writing', priority: 10 },
    ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
    resources: [{ slot: 'notes', kind: 'db', effect: 'read', required: true }],
  } as const;
  const presentation = {
    $schema: manifest.$schema,
    name: manifest.name,
    description: manifest.description,
    tool: { label: 'Notes', icon: null, group: 'writing', priority: 10 },
  } as const;
  const issue = {
    scope: 'published',
    code: 'filesystem_read_failed',
    message: 'secret host detail at /private/managed/widgets/notes-board',
    path: 'published/notes-board/server-dist/secret.ts',
  } as const;
  return {
    format: 'omnidraw.widget-catalog.v1',
    generation: 7,
    digestSha256: SHA,
    rootIdentity: '/private/managed/widgets:44:91',
    healthy: true,
    entries: {
      'notes-board': {
        slug: 'notes-board',
        health: 'healthy',
        placeable: true,
        differences: {
          availability: 'draft-and-published',
          manifest: 'same',
          presentation: 'same',
          executableManifest: 'same',
          status: 'matched',
        },
        draft: {
          kind: 'draft',
          slug: 'notes-board',
          relativePath: 'drafts/notes-board',
          health: 'healthy',
          manifest,
          manifestDigestSha256: SHA,
          presentation,
          presentationDigestSha256: SHA,
          executable: { schemaVersion: 1, ui: manifest.ui, server: null, resources: manifest.resources },
          executableManifestDigestSha256: SHA,
          treeDigestSha256: 'b'.repeat(64),
          files: [{ path: 'ui/main.ts', byteSize: 12, sha256: SHA }],
          issues: [],
        },
        published: {
          kind: 'published',
          slug: 'notes-board',
          relativePath: 'published/notes-board',
          health: 'healthy',
          manifest,
          manifestDigestSha256: SHA,
          presentation,
          presentationDigestSha256: SHA,
          executable: { schemaVersion: 1, ui: manifest.ui, server: null, resources: manifest.resources },
          executableManifestDigestSha256: SHA,
          treeDigestSha256: 'c'.repeat(64),
          files: [{ path: 'server-dist/private.js', byteSize: 12, sha256: SHA }],
          release: {
            format: 'omnidraw.widget-release.v1',
            executableManifestDigestSha256: SHA,
            files: [],
            capsule: null,
            server: null,
            releaseAttestation: {
              algorithm: 'Ed25519',
              keyId: 'private-signing-key',
              signatureBase64: 'private-signature',
            },
          },
          releaseDescriptorDigestSha256: 'd'.repeat(64),
          releaseValidation: { valid: true },
          capsuleRuntime: null,
          functions: [{
            schemaVersion: 1,
            exportName: 'lookupNotes',
            modulePath: 'server-dist/private.js',
            effect: 'fn',
            inputSchema: {},
            outputSchema: {},
            resources: [],
            limits: {
              timeoutMs: 1_000,
              memoryTier: 'small',
              outputByteLimit: 1_024,
              logByteLimit: 1_024,
            },
          }],
          issues: [issue],
        },
      },
    },
    issues: [issue],
  } as unknown as TWidgetCatalogSnapshot;
}

describe('filesystem widget public catalog projection', () => {
  test('returns only the bounded API-owned browser projection', () => {
    const projected = ZWidgetPublicCatalog.parse(fnProjectWidgetPublicCatalog(snapshot()));
    const serialized = JSON.stringify(projected);

    expect(projected.groups).toEqual(['writing']);
    expect(projected.entries[0]?.placement?.reference).toEqual({
      source: 'published',
      widgetKey: 'notes-board',
      catalogGeneration: 7,
    });
    expect(projected.entries[0]?.published?.functions[0]).toMatchObject({
      exportName: 'lookupNotes',
    });
    expect(serialized).not.toContain('modulePath');
    expect(serialized).not.toContain('rootIdentity');
    expect(serialized).not.toContain('relativePath');
    expect(serialized).not.toContain('releaseAttestation');
    expect(serialized).not.toContain('private-signing-key');
    expect(serialized).not.toContain('/private/managed');
    expect(serialized).not.toContain('server-dist/private.js');
    expect(projected.issues).toEqual([{
      code: 'filesystem_read_failed',
      message: 'Widget files could not be read safely.',
    }]);
  });
});
