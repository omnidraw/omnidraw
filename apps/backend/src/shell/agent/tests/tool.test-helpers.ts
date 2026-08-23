import { onTestFinished } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { TSessionEntryManager } from '../tools/types';

export async function makeTempDir() {
  const path = await mkdtemp(join(tmpdir(), 'vc-service-agent-tools-'));
  onTestFinished(() => rm(path, { recursive: true, force: true }));
  return path;
}

export function createFakeSessionManager(): TSessionEntryManager & { entries: SessionEntry[] } {
  const entries: SessionEntry[] = [];

  return {
    entries,
    appendCustomEntry(customType: string, data?: unknown) {
      entries.push({
        id: `entry-${entries.length + 1}`,
        parentId: entries.at(-1)?.id ?? null,
        timestamp: new Date().toISOString(),
        type: 'custom',
        customType,
        data,
      });
      return entries.at(-1)?.id ?? 'entry-1';
    },
    getEntries() {
      return [...entries];
    },
  };
}

export async function executeTool(tool: { execute: (...args: any[]) => Promise<any> }, params: unknown = {}) {
  return tool.execute('tool-call', params, undefined, undefined, {} as any);
}
