import { EventPublisherService } from '@omnidraw/service-event-publisher/EventPublisherService';

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
