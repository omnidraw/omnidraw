import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreviewInspectionShellServer } from '../src/shell/preview/PreviewInspectionShellServer';

const TOKEN = 'preview-inspection-token-000001';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function seal(root: string, html: string, javascript: string): Promise<string> {
  const files = [
    { path: 'assets/main.js', bytes: Buffer.byteLength(javascript), sha256: digest(javascript) },
    { path: 'index.html', bytes: Buffer.byteLength(html), sha256: digest(html) },
  ];
  const buildId = `sha256:${digest(JSON.stringify(files))}`;
  await writeFile(join(root, '.omnidraw-inspection-dist.json'), `${JSON.stringify({
    format: 'omnidraw.preview-inspection-dist.v1',
    buildId,
    files,
  })}\n`);
  return buildId;
}

describe('PreviewInspectionShellServer', () => {
  let root: string;
  let server: PreviewInspectionShellServer;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'omnidraw-preview-shell-test-'));
    await mkdir(join(root, 'assets'));
    const html = '<!doctype html><title>inspection</title>';
    const javascript = 'globalThis.inspection = true;';
    await writeFile(join(root, 'index.html'), html);
    await writeFile(join(root, 'assets', 'main.js'), javascript);
    await seal(root, html, javascript);
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
    expect(head.headers.get('content-length')).toBe(String(Buffer.byteLength('<!doctype html><title>inspection</title>')));
    expect(head.headers.get('content-type')).toBe('text/html; charset=utf-8');

    const post = await fetch(lease.url, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  test('serves the exact verified read even when the path changes before response consumption', async () => {
    await server.stop();
    const assetPath = join(root, 'assets', 'main.js');
    const verifiedJavascript = 'globalThis.inspection = true;';
    const replacedJavascript = 'globalThis.inspection = "replaced after verification";';
    let replaceOnAssetRead = false;
    server = new PreviewInspectionShellServer({
      distPath: root,
      createToken: () => TOKEN,
      async readFile(path) {
        const bytes = await readFile(path);
        if (replaceOnAssetRead && path.endsWith('/assets/main.js')) {
          replaceOnAssetRead = false;
          await writeFile(assetPath, replacedJavascript);
        }
        return bytes;
      },
    });
    const lease = await server.open('verified-byte-snapshot');
    replaceOnAssetRead = true;

    const assetUrl = new URL('assets/main.js', lease.url);
    const response = await fetch(assetUrl);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(verifiedJavascript)));
    expect(await response.text()).toBe(verifiedJavascript);
    expect(await readFile(assetPath, 'utf8')).toBe(replacedJavascript);
    lease.release();
  });

  test('rejects partial or changed output instead of serving watcher intermediates', async () => {
    await writeFile(join(root, 'assets', 'main.js'), 'partial watcher output');
    await expect(server.verify()).rejects.toMatchObject({ code: 'INSPECTION_SHELL_UNVERIFIED' });
    await expect(server.open('partial')).rejects.toMatchObject({ code: 'INSPECTION_SHELL_UNVERIFIED' });
  });

  test('pins an immutable verified root for each lease across atomic shell replacement', async () => {
    await server.stop();
    const builds = join(root, 'builds');
    const first = join(builds, 'first');
    const second = join(builds, 'second');
    await mkdir(join(first, 'assets'), { recursive: true });
    await mkdir(join(second, 'assets'), { recursive: true });
    for (const [directory, title] of [[first, 'first'], [second, 'second']] as const) {
      const html = `<!doctype html><title>${title}</title>`;
      const javascript = `globalThis.inspection = '${title}';`;
      await writeFile(join(directory, 'index.html'), html);
      await writeFile(join(directory, 'assets', 'main.js'), javascript);
      await seal(directory, html, javascript);
    }
    const current = join(root, 'current');
    await symlink(first, current, 'dir');
    let tokenIndex = 0;
    server = new PreviewInspectionShellServer({
      distPath: current,
      createToken: () => `${TOKEN}-${tokenIndex += 1}`,
    });
    const firstLease = await server.open('first');
    const replacement = join(root, 'replacement');
    await symlink(second, replacement, 'dir');
    await rename(replacement, current);
    const secondLease = await server.open('second');
    expect(await (await fetch(firstLease.url)).text()).toContain('<title>first</title>');
    expect(await (await fetch(secondLease.url)).text()).toContain('<title>second</title>');
    firstLease.release();
    secondLease.release();
  });
});
