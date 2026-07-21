import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'fs';
import { getRequestTempDirectory, uploadPtyImageToTemp } from './api.upload-image';

const cleanupPaths = new Set<string>();

afterEach(() => {
  for (const path of cleanupPaths) {
    rmSync(path, { recursive: true, force: true });
  }
  cleanupPaths.clear();
});

describe('api.upload-image', () => {
  test('writes clipboard image bytes to temp storage and returns absolute path', async () => {
    const requestId = `test-${crypto.randomUUID()}`;
    const result = await uploadPtyImageToTemp({
      requestId,
      base64: Buffer.from('png-bytes').toString('base64'),
      format: 'image/png',
    });

    const root = getRequestTempDirectory(requestId);
    cleanupPaths.add(root);

    expect(result.path.startsWith(root)).toBe(true);
    expect(result.path.endsWith('.png')).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    expect(readFileSync(result.path).toString('utf8')).toBe('png-bytes');
  });

  test('accepts data url payloads', async () => {
    const requestId = `test-${crypto.randomUUID()}`;
    const result = await uploadPtyImageToTemp({
      requestId,
      base64: `data:image/gif;base64,${Buffer.from('gif-bytes').toString('base64')}`,
      format: 'image/gif',
    });

    const root = getRequestTempDirectory(requestId);
    cleanupPaths.add(root);

    expect(result.path.endsWith('.gif')).toBe(true);
    expect(readFileSync(result.path).toString('utf8')).toBe('gif-bytes');
  });
});
