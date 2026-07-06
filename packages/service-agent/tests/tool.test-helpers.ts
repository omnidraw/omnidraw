import { afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { TActorCandidate, TCandidateSessionManager } from '../src/tools/types';

const tempRoots: string[] = [];

export async function makeTempDir() {
  const path = await mkdtemp(join(tmpdir(), 'vc-service-agent-tools-'));
  tempRoots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

export function sampleCandidate(overrides: Partial<TActorCandidate> = {}): TActorCandidate {
  return {
    name: 'Counter Widget',
    description: 'A generated counter widget.',
    actor: {
      initialState: 'ready',
      initialData: { count: 0 },
      dataSchema: {
        type: 'object',
        properties: {
          count: { type: 'integer', minimum: 0 },
        },
        required: ['count'],
        additionalProperties: false,
      },
      states: {
        ready: {
          on: {
            'in.increment': {
              func: ['tx.increment'],
              allowedTargetStates: ['ready'],
            },
          },
        },
        error: {
          on: {
            'in.resetError': {
              func: ['tx.resetError'],
              allowedTargetStates: ['ready'],
            },
          },
        },
      },
      inputMsgSchema: {
        'in.increment': {
          type: 'object',
          properties: {
            amount: { type: 'integer', minimum: 1 },
          },
          required: ['amount'],
          additionalProperties: false,
        },
        'in.resetError': {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
      outputMsgSchema: {
        'out.countChanged': {
          type: 'object',
          properties: {
            count: { type: 'integer', minimum: 0 },
          },
          required: ['count'],
          additionalProperties: false,
        },
      },
    },
    widget: {
      tool: {
        label: 'Counter',
        icon: '🔢',
        group: 'Generated',
        priority: 10,
        behavior: { type: 'mode', mode: 'draw-create' },
      },
    },
    ...overrides,
  };
}

export function createFakeSessionManager(): TCandidateSessionManager & { entries: SessionEntry[] } {
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
