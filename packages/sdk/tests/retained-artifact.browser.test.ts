import { describe, expect, test } from 'bun:test';
import { chromium } from 'playwright';
import { buildCapsuleGuest } from '@omnidraw/capsule/build';
import { signCapsuleArtifactBytes } from '@omnidraw/capsule/sign';
import { CAPSULE_API_GROUP_BUNDLE_DIGEST } from '@omnidraw/capsule/protocol';
import { resolve } from 'node:path';
import retained from './fixtures/capsule-0.16-signed.json';

// Real browser + real Capsule verification; no mocked host or patched registry.
describe('signed retained Capsule artifacts', () => {
  test('mounts unchanged old/current bytes and rejects tampering and untrusted keys', async () => {
    const build = await Bun.build({ entrypoints: [resolve(import.meta.dir, '../src/host.ts')], target: 'browser', splitting: true });
    if (!build.success) throw new AggregateError(build.logs, 'Browser host bundle failed');
    const outputs = new Map(await Promise.all(build.outputs.map(async (output) => [
      `/${output.path.split('/').at(-1)}`, await output.text(),
    ] as const)));
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
      const bundle = outputs.get(new URL(request.url).pathname);
      return bundle !== undefined
        ? new Response(bundle, { headers: { 'Content-Type': 'text/javascript' } })
        : new Response('<!doctype html><div id="widget" style="width:400px;height:300px"></div>', { headers: { 'Content-Type': 'text/html' } });
    } });
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      browser = await chromium.launch({ headless: true, channel: process.env.OMNIDRAW_TEST_BROWSER_CHANNEL });
      expect(new Bun.CryptoHasher('sha256').update(Buffer.from(retained.artifactBase64, 'base64')).digest('hex')).toBe(retained.digestSha256);
      const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
      const hash = `sha256:${'a'.repeat(64)}` as const;
      const current = await buildCapsuleGuest({
        input: {
          kind: 'external-distribution',
          snapshot: { files: [{ path: 'main.js', bytes: new TextEncoder().encode(retained.source) }] },
          entry: 'main.js', producer: { name: 'retained-fixture', version: '1.0.0', digest: hash },
          sourceRevision: hash, dependencyLockDigest: hash, buildConfigurationDigest: hash,
        },
        apis: ['DOM'], parkability: { parkable: false },
        policy: { maxFiles: 128, maxFileBytes: 2097152, maxTotalBytes: 8388608, maxPathBytes: 256, maxPathDepth: 16, maxModules: 128, maxOutputBytes: 8388608 },
      });
      const currentBytes = await signCapsuleArtifactBytes(current.artifactBytes, [{ keyId: retained.keyId, privateKey: keyPair.privateKey }]);
      const currentFixture = {
        ...retained, artifactBase64: Buffer.from(currentBytes).toString('base64'),
        publicKeyBase64: Buffer.from(await crypto.subtle.exportKey('raw', keyPair.publicKey)).toString('base64'),
        artifactHash: current.artifactHash, bundleDigest: CAPSULE_API_GROUP_BUNDLE_DIGEST,
      };
      for (const scenario of ['retained', 'current', 'retained-runtime', 'current-runtime', 'tampered', 'untrusted', 'unknown-bundle'] as const) {
        const page = await browser.newPage();
        try {
          await page.goto(server.url.toString());
          const result = await page.evaluate(async ({ fixture, scenario, otherKey }) => {
            const modulePath = '/host.js';
            const { createWidgetBrowserHost } = await import(modulePath);
            let bytes = Uint8Array.from(atob(fixture.artifactBase64), (c) => c.charCodeAt(0));
            if (scenario === 'tampered') bytes[bytes.length - 1] ^= 1;
            if (scenario === 'unknown-bundle') {
              // Change the embedded contract, not just transport metadata. Even
              // recomputing the transport checksum cannot authorize new semantics.
              const old = new TextEncoder().encode(fixture.bundleDigest);
              const at = bytes.findIndex((_, i) => old.every((value, j) => bytes[i + j] === value));
              if (at < 0) throw new Error('Fixture contract not found');
              bytes.set(new TextEncoder().encode(`sha256:${'f'.repeat(64)}`), at);
            }
            const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
            const host = await createWidgetBrowserHost({ document, catalog: {
              generation: 'regression', allowedApis: ['DOM'], limits: {},
              previewSigningKeyId: fixture.keyId, releaseSigningKeyId: fixture.keyId,
              signingKeys: [{ keyId: fixture.keyId, algorithm: 'Ed25519', format: 'raw', publicKeyBase64: scenario === 'untrusted' ? otherKey : fixture.publicKeyBase64 }],
            } });
            try {
              const mount = await host[scenario.endsWith('-runtime') ? 'mount' : 'inspect']({
                mode: 'published', container: document.getElementById('widget'),
                artifact: { bytes, digestSha256: digest, artifactHash: fixture.artifactHash, functions: [], runtime: {
                  format: 'omnidraw.capsule-runtime.v2', artifactHash: fixture.artifactHash,
                  apiContract: { format: 'capsule-api-groups-v1', groups: ['DOM'], bundleDigest: fixture.bundleDigest },
                  budgets: {}, capabilityRequests: [], channels: null, parkability: { parkable: false }, signatureKeyIds: [fixture.keyId],
                } },
                subject: { canvasId: 'test', elementId: 'test', widgetInstanceId: 'test', widgetKey: 'test' },
                viewport: { width: 400, height: 300, scale: 1, visibility: 'visible', distance: 0, priority: 1, occlusion: 0 },
                theme: { format: 'omnidraw.widget-theme.v1', appearance: 'light', tokens: {} },
              });
              await mount.ready();
              const summary = mount.inspection === undefined ? '' : JSON.stringify(mount.inspection.query({ css: 'button' }));
              await mount.dispose();
              return { mounted: true, summary, code: '' };
            } catch (error) {
              const failure = error as { diagnostic?: { code?: string }; message?: string };
              return { mounted: false, summary: '', code: failure.diagnostic?.code ?? failure.message ?? String(error) };
            } finally { await host.dispose(); }
          }, { fixture: scenario.startsWith('current') ? currentFixture : retained, scenario, otherKey: currentFixture.publicKeyBase64 });
          if (scenario.startsWith('current') || scenario.startsWith('retained')) {
            expect(result).toMatchObject({ mounted: true });
            if (!scenario.endsWith('-runtime')) expect(result.summary).toContain('Retained artifact mounted');
          } else {
            expect(result.mounted).toBe(false);
            expect(result.code).toBe('ARTIFACT_REJECTED');
          }
        } finally { await page.close(); }
      }
    } finally {
      await browser?.close();
      await server.stop(true);
    }
  }, 60_000);
});
