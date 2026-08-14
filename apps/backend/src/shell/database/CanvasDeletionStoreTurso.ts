import type {
  TCanvasDeletionPlan,
  TCanvasDeletionResult,
} from '#backend/core/canvas/service.canvas-deletion';
import type { Database } from '@tursodatabase/database';
import { findCanvasRowById } from './DbServiceTurso/read-canvas';
import { runDatabaseTransaction } from './run-database-transaction';
import { DATABASE_STATEMENTS } from './statement-registry';

type TCountRow = Readonly<{ count: unknown }>;

function count(row: TCountRow | null, label: string): number {
  const value = Number(row?.count);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Stored ${label} count is invalid.`);
  }
  return value;
}

async function deletionPlan(
  database: Database,
  canvasId: string,
): Promise<TCanvasDeletionPlan | null> {
  const canvas = await findCanvasRowById({ db: database }, { id: canvasId });
  if (canvas === null) return null;
  const itemStatement = await database.prepare(DATABASE_STATEMENTS.canvasDeletionCountItems);
  const mediaStatement = await database.prepare(DATABASE_STATEMENTS.canvasDeletionCountMedia);
  const chatStatement = await database.prepare(DATABASE_STATEMENTS.canvasDeletionCountChats);
  const [items, media, chats] = await Promise.all([
    itemStatement.get(canvasId) as Promise<TCountRow | null>,
    mediaStatement.get(canvasId) as Promise<TCountRow | null>,
    chatStatement.get(canvasId) as Promise<TCountRow | null>,
  ]);
  return Object.freeze({
    canvas: Object.freeze(canvas),
    itemCount: count(items, 'Canvas item'),
    mediaCount: count(media, 'Canvas media'),
    retainedChatCount: count(chats, 'retained chat'),
  });
}

function plansEqual(actual: TCanvasDeletionPlan, expected: TCanvasDeletionPlan): boolean {
  return actual.canvas.id === expected.canvas.id
    && actual.canvas.name === expected.canvas.name
    && actual.canvas.revision === expected.canvas.revision
    && actual.canvas.createdAtSec === expected.canvas.createdAtSec
    && actual.canvas.updatedAtSec === expected.canvas.updatedAtSec
    && actual.itemCount === expected.itemCount
    && actual.mediaCount === expected.mediaCount
    && actual.retainedChatCount === expected.retainedChatCount;
}

export type TCanvasDeletionCommitStatus =
  | Readonly<{ status: 'deleted'; result: TCanvasDeletionResult }>
  | Readonly<{ status: 'not-found' }>
  | Readonly<{ status: 'stale'; actual: TCanvasDeletionPlan }>;

export class CanvasDeletionStoreTurso {
  readonly #receipts = new Map<string, Readonly<{
    canvasId: string;
    result: TCanvasDeletionResult;
  }>>();

  constructor(private readonly database: Database) {}

  plan(args: Readonly<{ canvasId: string }>): Promise<TCanvasDeletionPlan | null> {
    return deletionPlan(this.database, args.canvasId);
  }

  receipt(args: Readonly<{
    deletionId: string;
    canvasId: string;
  }>): TCanvasDeletionResult | null {
    const receipt = this.#receipts.get(args.deletionId);
    if (receipt === undefined) return null;
    if (receipt.canvasId !== args.canvasId) {
      throw new TypeError('A Canvas deletion id cannot be reused for another Canvas.');
    }
    return receipt.result;
  }

  async commit(args: Readonly<{
    deletionId: string;
    plan: TCanvasDeletionPlan;
  }>): Promise<TCanvasDeletionCommitStatus> {
    const receipt = this.receipt({ deletionId: args.deletionId, canvasId: args.plan.canvas.id });
    if (receipt !== null) return { status: 'deleted', result: receipt };
    const outcome = await runDatabaseTransaction({ database: this.database }, {
      mode: 'immediate',
      operation: async (): Promise<TCanvasDeletionCommitStatus> => {
        const actual = await deletionPlan(this.database, args.plan.canvas.id);
        if (actual === null) return { status: 'not-found' };
        if (!plansEqual(actual, args.plan)) return { status: 'stale', actual };

        const detached = await (await this.database.prepare(
          DATABASE_STATEMENTS.chatDetachArchiveByCanvas,
        )).run(args.plan.canvas.id);
        if (detached.changes !== actual.retainedChatCount) {
          throw new Error('The retained chat set changed during Canvas deletion.');
        }
        const deleted = await (await this.database.prepare(DATABASE_STATEMENTS.canvasDelete))
          .run(args.plan.canvas.id);
        if (deleted.changes !== 1) {
          throw new Error('The Canvas changed during coordinated deletion.');
        }
        return {
          status: 'deleted',
          result: Object.freeze({
            canvas: actual.canvas,
            cleanup: Object.freeze({
              itemCount: actual.itemCount,
              mediaCount: actual.mediaCount,
              retainedChatCount: actual.retainedChatCount,
            }),
          }),
        };
      },
    });
    if (outcome.status === 'deleted') {
      this.#receipts.set(args.deletionId, Object.freeze({
        canvasId: args.plan.canvas.id,
        result: outcome.result,
      }));
    }
    return outcome;
  }
}
