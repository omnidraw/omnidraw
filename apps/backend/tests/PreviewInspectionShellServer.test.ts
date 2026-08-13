import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreviewInspectionShellServer } from '../src/shell/preview/PreviewInspectionShellServer';

const TOKEN = 'preview-inspection-token-000001';

describe('PreviewInspectionShellServer', () => {
  let root: string;
  let server: PreviewInspectionShellServer;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'omnidraw-preview-shell-test-'));
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<!doctype html><title>inspection</title>');
    await writeFile(join(root, 'assets', 'main.js'), 'globalThis.inspection = true;');
    server = new PreviewInspectionShellServer({
      distPath: root,
      createToken: () => TOKEN,
    });
  });

  afterEach(async () => {
    await server.stop();
    await rm(root, { recursive: true, force: true });
  });

  test('serves one tokenized lease on loopback with no-store and isolation headers', async () => {
    const lease = await server.open('job-1');
    const url = new URL(lease.url);

    expect(url.protocol).toBe('http:');
    expect(url.hostname).toBe('127.0.0.1');
    expect(Number(url.port)).toBeGreaterThan(0);
    expect(url.pathname).toBe(`/${TOKEN}/index.html`);
    expect(url.hash).toBe('');

    const response = await fetch(lease.url);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>inspection</title>');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');

    lease.release();
    expect((await fetch(lease.url)).status).toBe(404);
  });

  test('rejects unknown tokens, unknown paths, and traversal attempts', async () => {
    const lease = await server.open('job-2');
    const leaseUrl = new URL(lease.url);
    const origin = leaseUrl.origin;

    expect((await fetch(`${origin}/unknown/index.html`)).status).toBe(404);
    expect((await fetch(`${origin}/${TOKEN}/missing.js`)).status).toBe(404);
    expect((await fetch(`${origin}/${TOKEN}/%2e%2e%2findex.html`)).status).toBe(404);
    expect((await fetch(`${origin}/${TOKEN}/assets/..%2f..%2findex.html`)).status).toBe(404);

    const asset = await fetch(`${origin}/${TOKEN}/assets/main.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('globalThis.inspection = true;');
  });

  test('allows HEAD without a body and rejects mutating methods', async () => {
    const lease = await server.open('job-3');

    const head = await fetch(lease.url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(head.headers.get('cache-control')).toBe('no-store');

    const post = await fetch(lease.url, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('content-security-policy')).toContain("default-src 'none'");
  });
});
