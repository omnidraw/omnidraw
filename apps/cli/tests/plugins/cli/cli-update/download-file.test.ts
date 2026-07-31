import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { downloadFile } from '../../../../src/plugins/cli/cmds/cmd.upgrade';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('downloadFile', () => {
  test('streams multiple chunks and reports a known total', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('hello '));
          controller.enqueue(new TextEncoder().encode('world'));
          controller.close();
        },
      }), { headers: { 'content-length': '11' } }),
    });
    const root = mkdtempSync(join(tmpdir(), 'omnidraw-download-test-'));
    roots.push(root);
    const progress: Array<{ downloadedBytes: number; totalBytes?: number }> = [];
    try {
      await downloadFile(`${server.url}asset`, join(root, 'asset'), { onProgress: (event) => progress.push(event) });
      expect(readFileSync(join(root, 'asset'), 'utf8')).toBe('hello world');
      expect(progress.at(-1)).toEqual({ downloadedBytes: 11, totalBytes: 11 });
    } finally {
      server.stop(true);
    }
  });

  test('reports unknown totals without inventing one', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('bytes'));
          setTimeout(() => controller.close(), 5);
        },
      })),
    });
    const root = mkdtempSync(join(tmpdir(), 'omnidraw-download-test-'));
    roots.push(root);
    const progress: Array<{ downloadedBytes: number; totalBytes?: number }> = [];
    try {
      await downloadFile(`${server.url}asset`, join(root, 'asset'), { onProgress: (event) => progress.push(event) });
      expect(progress.at(-1)).toEqual({ downloadedBytes: 5, totalBytes: undefined });
    } finally {
      server.stop(true);
    }
  });

  test('fails stalled streams and removes the partial file', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); } })),
    });
    const root = mkdtempSync(join(tmpdir(), 'omnidraw-download-test-'));
    roots.push(root);
    const destination = join(root, 'asset');
    try {
      await expect(downloadFile(`${server.url}asset`, destination, { inactivityTimeoutMs: 30 })).rejects.toThrow('Download stalled');
      expect(existsSync(destination)).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test('removes a partial file when the response fails mid-stream', async () => {
    const fetchImpl = async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          setTimeout(() => controller.error(new Error('connection lost')), 1);
        },
      }));
    const root = mkdtempSync(join(tmpdir(), 'omnidraw-download-test-'));
    roots.push(root);
    const destination = join(root, 'asset');
    await expect(downloadFile('https://example.test/asset', destination, { fetchImpl })).rejects.toThrow('connection lost');
    expect(existsSync(destination)).toBe(false);
  });

  test('rejects HTTP errors without creating a file', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('missing', { status: 404 }) });
    const root = mkdtempSync(join(tmpdir(), 'omnidraw-download-test-'));
    roots.push(root);
    const destination = join(root, 'asset');
    try {
      await expect(downloadFile(`${server.url}asset`, destination)).rejects.toThrow('Download failed (404)');
      expect(existsSync(destination)).toBe(false);
    } finally {
      server.stop(true);
    }
  });
});
