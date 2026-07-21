import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fnFreezeTenantContext, type TTenantContext } from '@vibecanvas/tenant-core';
import { getRequestTempDirectory, uploadPtyImageToTemp } from './api.upload-image';

const cleanupPaths = new Set<string>();

function tenant(orgId: string, accountId: string, requestId: string): TTenantContext {
  return fnFreezeTenantContext({
    orgId,
    accountId,
    requestId,
    cellId: 'test-cell',
    placementEpoch: 1,
    roles: ['owner'],
    capabilities: ['pty:write'],
  });
}

afterEach(() => {
  for (const path of cleanupPaths) {
    rmSync(path, { recursive: true, force: true });
  }
  cleanupPaths.clear();
});

describe('api.upload-image', () => {
  test('writes clipboard image bytes to scoped storage and returns only a virtual path', async () => {
    const requestId = `test-${crypto.randomUUID()}`;
    const context = tenant('org-a', 'account-a', requestId);
    const hostRoot = mkdtempSync(join(tmpdir(), 'vibecanvas-api-pty-upload-'));
    const virtualRoot = getRequestTempDirectory(context);
    const hostDirectory = join(hostRoot, virtualRoot);
    cleanupPaths.add(hostRoot);
    const result = await uploadPtyImageToTemp({
      tenant: context,
      hostDirectory,
      base64: Buffer.from('png-bytes').toString('base64'),
      format: 'image/png',
    });

    expect(result.path.startsWith(virtualRoot)).toBe(true);
    expect(result.path.startsWith('/')).toBe(false);
    expect(result.path.endsWith('.png')).toBe(true);
    expect(existsSync(join(hostRoot, result.path))).toBe(true);
    expect(readFileSync(join(hostRoot, result.path)).toString('utf8')).toBe('png-bytes');
  });

  test('accepts data url payloads', async () => {
    const requestId = `test-${crypto.randomUUID()}`;
    const context = tenant('org-a', 'account-a', requestId);
    const hostRoot = mkdtempSync(join(tmpdir(), 'vibecanvas-api-pty-upload-'));
    const virtualRoot = getRequestTempDirectory(context);
    cleanupPaths.add(hostRoot);
    const result = await uploadPtyImageToTemp({
      tenant: context,
      hostDirectory: join(hostRoot, virtualRoot),
      base64: `data:image/gif;base64,${Buffer.from('gif-bytes').toString('base64')}`,
      format: 'image/gif',
    });

    expect(result.path.endsWith('.gif')).toBe(true);
    expect(readFileSync(join(hostRoot, result.path)).toString('utf8')).toBe('gif-bytes');
  });

  test('isolates identical request IDs by organization and account', async () => {
    const requestId = 'same-request';
    const tenantA = tenant('org-a', 'account-a', requestId);
    const tenantB = tenant('org-b', 'account-b', requestId);
    const rootA = getRequestTempDirectory(tenantA);
    const rootB = getRequestTempDirectory(tenantB);
    const hostRoot = mkdtempSync(join(tmpdir(), 'vibecanvas-api-pty-upload-'));
    cleanupPaths.add(hostRoot);

    expect(rootA).not.toBe(rootB);
    expect(rootA).not.toContain('org-a');
    expect(rootB).not.toContain('org-b');

    const [resultA, resultB] = await Promise.all([
      uploadPtyImageToTemp({
        tenant: tenantA,
        hostDirectory: join(hostRoot, rootA),
        base64: Buffer.from('a').toString('base64'),
        format: 'image/png',
      }),
      uploadPtyImageToTemp({
        tenant: tenantB,
        hostDirectory: join(hostRoot, rootB),
        base64: Buffer.from('b').toString('base64'),
        format: 'image/png',
      }),
    ]);

    expect(resultA.path.startsWith(rootA)).toBe(true);
    expect(resultB.path.startsWith(rootB)).toBe(true);
  });
});
