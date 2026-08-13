import { EventPublisherService } from '#backend/shell/events/EventPublisherService';
import { createHash, randomUUID } from 'node:crypto';

export function testChatId(label: string): string {
  const digest = createHash('sha256').update(label).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export function testWorkspaceWorld() {
  return Object.freeze({ platform: process.platform, createId: randomUUID });
}

export function testApprovalWorld() {
  return Object.freeze({ createId: randomUUID, now: () => new Date() });
}

export function testAgentWorld() {
  return Object.freeze({ ...testWorkspaceWorld(), now: () => new Date() });
}

type TChatRecord = Readonly<{
  id: string;
  canvasId: string | null;
  name: string;
  status: 'active' | 'archived' | 'error';
  workspaceRelativePath: string;
  historyRelativePath: string;
}>;

export function createTestEvents(): EventPublisherService {
  return new EventPublisherService();
}

export function createTestChats() {
  const records = new Map<string, TChatRecord>();
  return {
    records,
    async get(args: Readonly<{ id: string }>) {
      return records.get(args.id) ?? null;
    },
    async create(args: Omit<TChatRecord, 'status'>) {
      if (records.has(args.id)) throw new Error(`Chat '${args.id}' already exists.`);
      const created = Object.freeze({ ...args, status: 'active' as const });
      records.set(args.id, created);
      return created;
    },
    async update(args: Readonly<{
      id: string;
      canvasId?: string;
      name?: string;
      status?: TChatRecord['status'];
    }>) {
      const current = records.get(args.id);
      if (!current) return null;
      const updated = Object.freeze({ ...current, ...args });
      records.set(args.id, updated);
      return updated;
    },
  };
}

export function createTestChatScope() {
  return {
    defaultCanvasId: 'canvas-test',
    validate: async () => true,
  };
}

export function createTestWidgetReferenceResolver() {
  return {
    async resolve(references: readonly Readonly<{ name: string; source: 'draft' | 'published' }>[]) {
      return {
        catalogGeneration: 1,
        catalogDigestSha256: '0'.repeat(64),
        references: references.map((reference) => ({
          widgetKey: reference.name,
          requestedVariant: reference.source,
          displayName: reference.name,
          health: 'healthy' as const,
          draftAvailable: false,
          publicationAvailable: reference.source === 'published',
          requirements: [],
          editableDraft: null,
        })),
      };
    },
    assertCurrent: async () => undefined,
  };
}
