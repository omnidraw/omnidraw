import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbServiceBunSqlite } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import * as schema from '@vibecanvas/service-db/schema';
import { SqliteWorkflowDb } from '@vibecanvas/service-workflow';
import type { TActorMachineConfig, TActorJson } from '../src/index';

export type TActorTestDb = {
  readonly dbService: DbServiceBunSqlite;
  readonly db: DbServiceBunSqlite['drizzle'];
  readonly workflowDb: SqliteWorkflowDb;
  readonly workspaceId: string;
  readonly canvasId: string;
  readonly sourceActorId: string;
  readonly sinkActorId: string;
  readonly cleanup: () => Promise<void>;
};

export async function createActorTestDb(): Promise<TActorTestDb> {
  const root = mkdtempSync(join(tmpdir(), 'vibecanvas-service-actor-'));
  const dbService = new DbServiceBunSqlite({ databasePath: join(root, 'test.sqlite'), dataDir: root, cacheDir: root, silentMigrations: true });
  await dbService.start();
  const db = dbService.drizzle;
  const canvasId = 'canvas-actor-test';
  db.insert(schema.canvas).values({ id: canvasId, name: `Actor canvas ${root}`, automerge_url: `automerge:${root}` }).run();

  const source = seedActor(db, { canvasId, actorId: 'source-actor', inputName: 'msg.in.booting', actions: ['tx.emit'] });
  const sink = seedActor(db, { canvasId, actorId: 'sink-actor', inputName: 'msg.in.booting', actions: ['tx.remember'] });

  db.insert(schema.actor_connections).values({
    id: 'connection-source-sink',
    canvas_id: canvasId,
    source_element_id: source.elementId,
    source_actor_instance_id: source.actorId,
    target_element_id: sink.elementId,
    target_actor_instance_id: sink.actorId,
    enabled: true,
    event_name_whitelist: ['msg.out.booting'],
    style: {},
  }).run();

  return {
    dbService,
    db,
    workflowDb: new SqliteWorkflowDb({ db }),
    workspaceId: 'workspace-system',
    canvasId,
    sourceActorId: source.actorId,
    sinkActorId: sink.actorId,
    cleanup: async () => {
      await dbService.stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function seedActor(
  db: DbServiceBunSqlite['drizzle'],
  args: { readonly canvasId: string; readonly actorId: string; readonly inputName: string; readonly actions: readonly string[] },
): { readonly actorId: string; readonly elementId: string } {
  const definitionId = `definition-${args.actorId}`;
  const revisionId = `revision-${args.actorId}`;
  const actorId = `instance-${args.actorId}`;
  const elementId = `element-${args.actorId}`;

  db.insert(schema.actor_definitions).values({ id: definitionId, name: args.actorId, slug: args.actorId, current_revision_id: revisionId }).run();
  db.insert(schema.actor_revisions).values({
    id: revisionId,
    actor_definition_id: definitionId,
    version: '0.0.1',
    revision_hash: `sha256:${args.actorId}`,
    machine_schema: {},
    machine_config: createMachineConfig(args.inputName, args.actions),
    contract_schema: { 'msg.in.booting': { public: false, schema: {} } },
    output_schema: {},
    server_manifest: { modulePath: './actor-test-bundle.mjs', functions: { fns: [], fxs: [], txs: ['tx.emit', 'tx.remember'] } },
    ui_manifest: {},
  }).run();
  db.insert(schema.actor_instances).values({
    id: actorId,
    workspace_id: 'workspace-system',
    canvas_id: args.canvasId,
    element_id: elementId,
    actor_definition_id: definitionId,
    actor_revision_id: revisionId,
    display_name: args.actorId,
    status: 'running',
    machine_state: 'booting',
    machine_context: {},
  }).run();

  return { actorId, elementId };
}

export function createMachineConfig(inputName: string, actions: readonly string[]): TActorMachineConfig {
  return {
    initialState: 'booting',
    initialContext: {},
    states: {
      booting: { on: { [inputName]: { target: 'booting', actions } } },
    },
  };
}

export function patchContext(context: TActorJson, patch: Record<string, TActorJson>): TActorJson {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return patch;
  return { ...context, ...patch };
}
