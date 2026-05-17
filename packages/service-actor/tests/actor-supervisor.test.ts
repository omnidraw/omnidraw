import { afterEach, describe, expect, test } from 'bun:test';
import * as schema from '@vibecanvas/service-db/schema';
import { ActorSupervisor } from '../src/index';
import { createActorTestDb } from './fixtures';

const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.();
});

describe('ActorSupervisor', () => {
  test('schedules actor workflows, commits outputs, and routes connected messages', async () => {
    const { db, workflowDb, workspaceId, canvasId, sourceActorId, sinkActorId, cleanup: cleanupDb } = await createActorTestDb();
    cleanup.push(cleanupDb);
    const supervisor = new ActorSupervisor({
      db,
      workflowDb,
      workerId: 'actor-test',
      idFactory: (() => {
        let index = 0;
        return () => `id-${index += 1}`;
      })(),
      now: () => new Date(1_000),
    });

    db.insert(schema.actor_inbox).values({
      id: 'inbox-message-1',
      workspace_id: workspaceId,
      canvas_id: canvasId,
      actor_instance_id: sourceActorId,
      seq: 1,
      message_id: 'message-1',
      correlation_id: 'corr-1',
      idempotency_key: 'message-1',
      event_name: 'msg.in.booting',
      params: { value: 1 },
      status: 'queued',
      attempt: 0,
      created_at: new Date(1),
    }).run();

    expect((await supervisor.runOnce()).status).toBe('scheduled');
    const sourceInstance = db.select().from(schema.actor_instances).all().find((row) => row.id === sourceActorId);
    if (!sourceInstance?.workflow_run_id) throw new Error('source workflow was not scheduled');
    const sourceSteps = await workflowDb.getStepsForRun(sourceInstance.workflow_run_id);
    expect(sourceSteps.map((step) => step.functionName)).toEqual(['tx.emit']);
    await workflowDb.patchStep(sourceSteps[0].id, {
      status: 'succeeded',
      result: { context: { lastPayload: { value: 1 } }, outputs: [{ name: 'msg.out.booting', payload: { value: 1 } }] },
      completedAt: new Date(2),
    });
    await workflowDb.completeRunAtomically(sourceInstance.workflow_run_id);

    expect((await supervisor.runOnce()).status).toBe('processed');
    const outputs = db.select().from(schema.actor_outputs).all().filter((row) => row.actor_instance_id === sourceActorId);
    expect(outputs).toHaveLength(1);
    expect(outputs[0].output_name).toBe('msg.out.booting');

    const routed = db.select().from(schema.actor_inbox).all().filter((row) => row.actor_instance_id === sinkActorId);
    expect(routed).toHaveLength(1);
    expect(routed[0].event_name).toBe('msg.in.booting');
    expect(routed[0].source_actor_instance_id).toBe(sourceActorId);

    expect((await supervisor.runOnce()).status).toBe('scheduled');
    const sinkInstance = db.select().from(schema.actor_instances).all().find((row) => row.id === sinkActorId);
    if (!sinkInstance?.workflow_run_id) throw new Error('sink workflow was not scheduled');
    const sinkSteps = await workflowDb.getStepsForRun(sinkInstance.workflow_run_id);
    await workflowDb.patchStep(sinkSteps[0].id, {
      status: 'succeeded',
      result: { context: { lastPayload: { value: 1 } } },
      completedAt: new Date(3),
    });
    await workflowDb.completeRunAtomically(sinkInstance.workflow_run_id);

    expect((await supervisor.runOnce()).status).toBe('processed');
    const finalSink = db.select().from(schema.actor_instances).all().find((row) => row.id === sinkActorId);
    expect(finalSink?.machine_context).toEqual({ lastPayload: { value: 1 } });
  });

  test('processes trusted built-in todo actor messages without API mutations', async () => {
    const { db, workflowDb, canvasId, cleanup: cleanupDb } = await createActorTestDb();
    cleanup.push(cleanupDb);
    db.insert(schema.actor_definitions).values({ id: 'definition-todo', name: 'Todo', slug: 'todo', current_revision_id: 'revision-todo' }).run();
    db.insert(schema.actor_revisions).values({
      id: 'revision-todo',
      actor_definition_id: 'definition-todo',
      version: '0.2.0',
      revision_hash: 'builtin:todo:0.2.0',
      machine_config: {
        initialState: 'ready',
        initialContext: { items: [] },
        states: {
          ready: {
            on: {
              'msg.in.booting': { target: 'ready', actions: [] },
              'todo.add': { target: 'ready', actions: ['tx.todo.add'] },
              'todo.toggle': { target: 'ready', actions: ['tx.todo.toggle'] },
            },
          },
        },
      },
      machine_schema: {},
      contract_schema: {},
      output_schema: {},
      server_manifest: { kind: 'builtin', handler: 'todo' },
      ui_manifest: {},
    }).run();
    db.insert(schema.actor_instances).values({
      id: 'instance-todo',
      workspace_id: null,
      canvas_id: canvasId,
      element_id: 'element-todo',
      actor_definition_id: 'definition-todo',
      actor_revision_id: 'revision-todo',
      display_name: 'Todo',
      status: 'created',
      machine_state: 'ready',
      machine_context: { items: [] },
    }).run();
    const supervisor = new ActorSupervisor({ db, workflowDb, idFactory: () => 'id-todo', now: () => new Date(10) });

    await supervisor.loadActors();
    expect((await supervisor.runOnce()).status).toBe('processed');
    expect(db.select().from(schema.actor_instances).all().find((row) => row.id === 'instance-todo')?.status).toBe('running');

    db.insert(schema.actor_inbox).values({
      id: 'inbox-todo-add',
      workspace_id: null,
      canvas_id: canvasId,
      actor_instance_id: 'instance-todo',
      seq: 2,
      message_id: 'message-todo-add',
      correlation_id: 'message-todo-add',
      idempotency_key: 'message-todo-add',
      event_name: 'todo.add',
      params: { title: 'Ship bridge' },
      status: 'queued',
      attempt: 0,
      created_at: new Date(11),
    }).run();

    expect((await supervisor.runOnce()).status).toBe('processed');
    const context = db.select().from(schema.actor_instances).all().find((row) => row.id === 'instance-todo')?.machine_context;
    expect(context).toEqual({ items: [{ id: 'Ship bridge:1', title: 'Ship bridge', completed: false }] });
  });

  test('loadActors queues boot messages for created actors without accounts', async () => {
    const { db, workflowDb, canvasId, cleanup: cleanupDb } = await createActorTestDb();
    cleanup.push(cleanupDb);
    db.insert(schema.actor_definitions).values({ id: 'definition-created', name: 'created', slug: 'created', current_revision_id: 'revision-created' }).run();
    db.insert(schema.actor_revisions).values({
      id: 'revision-created',
      actor_definition_id: 'definition-created',
      version: '0.0.1',
      revision_hash: 'sha256:created',
      machine_config: { states: { booting: { on: { 'msg.in.booting': { target: 'booting', actions: [] } } } } },
      machine_schema: {},
      contract_schema: {},
      output_schema: {},
      server_manifest: {},
      ui_manifest: {},
    }).run();
    db.insert(schema.actor_instances).values({
      id: 'instance-created',
      workspace_id: null,
      canvas_id: canvasId,
      element_id: 'element-created',
      actor_definition_id: 'definition-created',
      actor_revision_id: 'revision-created',
      display_name: 'Created actor',
      status: 'created',
      machine_state: 'booting',
      machine_context: {},
    }).run();
    const supervisor = new ActorSupervisor({ db, workflowDb, idFactory: () => 'boot-inbox-id', now: () => new Date(10) });

    await supervisor.loadActors();

    const boot = db.select().from(schema.actor_inbox).all().find((row) => row.actor_instance_id === 'instance-created');
    expect(boot?.event_name).toBe('msg.in.booting');
    expect(boot?.workspace_id).toBeNull();
    expect(db.select().from(schema.actor_instances).all().find((row) => row.id === 'instance-created')?.status).toBe('starting');
  });
});
