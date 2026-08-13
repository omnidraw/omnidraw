import { DATABASE_STATEMENTS } from './statement-registry';
import type { Database } from '@tursodatabase/database';
import type { TChat } from './model';
import { runDatabaseWrite } from './run-database-transaction';

export type TChatCreateArgs = Readonly<{
  id: string;
  canvasId: string | null;
  name: string;
  workspaceRelativePath: string;
  historyRelativePath: string;
}>;

export type TChatUpdateArgs = Readonly<{
  id: string;
  canvasId?: string;
  name?: string;
  status?: TChat['status'];
}>;

export type TChatListArgs = Readonly<{
  canvasId?: string | null;
  status?: TChat['status'];
  limit?: number;
}>;

type TChatRow = Readonly<{
  id: string;
  canvas_id: string | null;
  name: string;
  status: TChat['status'];
  workspace_relative_path: string;
  history_relative_path: string;
  created_at_sec: unknown;
  updated_at_sec: unknown;
}>;

const CHAT_LIST_DEFAULT_LIMIT = 50;
const CHAT_LIST_MAX_LIMIT = 200;

function timestampSec(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
  ) {
    throw new TypeError(`Stored ${label} is not a UTC whole-second timestamp.`);
  }
  return value;
}

function chat(row: TChatRow): TChat {
  return {
    id: row.id,
    canvasId: row.canvas_id,
    name: row.name,
    status: row.status,
    workspaceRelativePath: row.workspace_relative_path,
    historyRelativePath: row.history_relative_path,
    createdAtSec: timestampSec(row.created_at_sec, 'chat creation time'),
    updatedAtSec: timestampSec(row.updated_at_sec, 'chat update time'),
  };
}

/** Minimal durable single-user chat metadata; drafts and Preview remain filesystem/process state. */
export class ChatStoreTurso {
  constructor(private readonly database: Database) {}

  async create(args: TChatCreateArgs): Promise<TChat> {
    await runDatabaseWrite({ database: this.database }, {
      operation: async () => {
        await (await this.database.prepare(DATABASE_STATEMENTS.chatInsertChats)).run(
          args.id,
          args.canvasId,
          args.name,
          args.workspaceRelativePath,
          args.historyRelativePath,
        );
      },
    });
    const created = await this.get({ id: args.id });
    if (!created) throw new Error(`Failed to create chat '${args.id}'.`);
    return created;
  }

  async get(args: Readonly<{ id: string }>): Promise<TChat | null> {
    const row = await (await this.database.prepare(DATABASE_STATEMENTS.chatReadChats)).get(args.id) as TChatRow | null;
    return row ? chat(row) : null;
  }

  async list(args: TChatListArgs = {}): Promise<readonly TChat[]> {
    const limit = args.limit ?? CHAT_LIST_DEFAULT_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > CHAT_LIST_MAX_LIMIT) {
      throw new RangeError(`Chat list limit must be between 1 and ${CHAT_LIST_MAX_LIMIT}.`);
    }
    const parameters: Array<string | number> = [];
    let statement: string;
    if (args.canvasId === null) {
      statement = args.status === undefined
        ? DATABASE_STATEMENTS.chatListWithoutCanvas
        : DATABASE_STATEMENTS.chatListWithoutCanvasByStatus;
    } else if (args.canvasId !== undefined) {
      statement = args.status === undefined
        ? DATABASE_STATEMENTS.chatListByCanvas
        : DATABASE_STATEMENTS.chatListByCanvasAndStatus;
      parameters.push(args.canvasId);
    } else {
      statement = args.status === undefined
        ? DATABASE_STATEMENTS.chatListAll
        : DATABASE_STATEMENTS.chatListAllByStatus;
    }
    if (args.status !== undefined) {
      parameters.push(args.status);
    }
    parameters.push(limit);
    const rows = await (await this.database.prepare(statement)).all(...parameters) as TChatRow[];
    return rows.map(chat);
  }

  async update(args: TChatUpdateArgs): Promise<TChat | null> {
    if (args.canvasId === undefined && args.name === undefined && args.status === undefined) {
      throw new TypeError('Chat update must change canvas, name, or status.');
    }
    const parameters: string[] = [];
    if (args.canvasId !== undefined) {
      parameters.push(args.canvasId);
    }
    if (args.name !== undefined) {
      parameters.push(args.name);
    }
    if (args.status !== undefined) {
      parameters.push(args.status);
    }
    const statement = args.canvasId !== undefined
      ? args.name !== undefined
        ? args.status !== undefined
          ? DATABASE_STATEMENTS.chatUpdateCanvasNameAndStatus
          : DATABASE_STATEMENTS.chatUpdateCanvasAndName
        : args.status !== undefined
          ? DATABASE_STATEMENTS.chatUpdateCanvasAndStatus
          : DATABASE_STATEMENTS.chatUpdateCanvas
      : args.name !== undefined
        ? args.status !== undefined
          ? DATABASE_STATEMENTS.chatUpdateNameAndStatus
          : DATABASE_STATEMENTS.chatUpdateName
        : DATABASE_STATEMENTS.chatUpdateStatus;
    parameters.push(args.id);
    const result = await runDatabaseWrite({ database: this.database }, {
      operation: async () => (
        (await this.database.prepare(statement)).run(...parameters)
      ),
    });
    return result.changes === 0 ? null : this.get({ id: args.id });
  }

  archive(args: Readonly<{ id: string }>): Promise<TChat | null> {
    return this.update({ id: args.id, status: 'archived' });
  }
}
