import { eq } from 'drizzle-orm';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { ActorService } from '@vibecanvas/service-actor';
import { DbServiceBunSqlite } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import * as schema from '@vibecanvas/service-db/schema';
import { SqliteWorkflowDb, WorkflowSuperviserService, WorkflowWorkerService, type TWorkflowJson } from '@vibecanvas/service-workflow';
import { getScenario, VISUALIZER_SCENARIOS } from './scenarios';
import type { TVisualizerEffectResult, TVisualizerScenario } from './types';

type TSubscriber = (snapshot: unknown) => void;
type TSourceMode = 'scenario' | 'db';

type TActorPosition = { readonly x: number; readonly y: number };

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function mergeEffectResults(initialContext: TWorkflowJson, results: readonly unknown[]): TWorkflowJson {
  let context = initialContext;
  for (const result of results) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) continue;
    const maybeContext = (result as { readonly context?: TWorkflowJson }).context;
    if (maybeContext !== undefined) context = maybeContext;
  }
  return context;
}

function serialize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Date ? item.toISOString() : item));
}

function findMonorepoRoot(startDir: string): string | null {
  let current = startDir;
  while (current !== dirname(current)) {
    if (existsSync(join(current, 'bun.lock'))) return current;
    current = dirname(current);
  }
  if (existsSync(join(current, 'bun.lock'))) return current;
  return null;
}

function resolveDevDbConfig() {
  const dbOverride = process.env.VIBECANVAS_DB;
  if (dbOverride) {
    const databasePath = resolve(process.cwd(), dbOverride);
    const baseDir = dirname(databasePath);
    mkdirSync(baseDir, { recursive: true });
    return { databasePath, dataDir: baseDir, cacheDir: baseDir };
  }

  const configOverride = process.env.VIBECANVAS_CONFIG;
  if (configOverride) {
    mkdirSync(configOverride, { recursive: true });
    return { databasePath: join(configOverride, 'vibecanvas.sqlite'), dataDir: configOverride, cacheDir: configOverride };
  }

  const monorepoRoot = findMonorepoRoot(process.cwd());
  if (!monorepoRoot) throw new Error(`Could not locate bun.lock from ${process.cwd()}`);
  const localVolume = join(monorepoRoot, 'local-volume');
  const dataDir = join(localVolume, 'data');
  const cacheDir = join(localVolume, 'cache');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  return { databasePath: join(dataDir, 'vibecanvas.sqlite'), dataDir, cacheDir };
}

function positionFromManifest(value: unknown): TActorPosition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as { readonly x?: unknown; readonly y?: unknown };
  if (typeof record.x !== 'number' || typeof record.y !== 'number') return null;
  return { x: record.x, y: record.y };
}

function fallbackPosition(index: number): TActorPosition {
  const columns = 4;
  return { x: 80 + (index % columns) * 390, y: 120 + Math.floor(index / columns) * 330 };
}

export class VisualizerRuntime {
  scenario: TVisualizerScenario;
  sourceMode: TSourceMode = 'scenario';
  selectedCanvasId: string | null = null;
  dbPath: string | null = null;
  dbService: DbServiceBunSqlite | null = null;
  workflowDb: SqliteWorkflowDb | null = null;
  workflowSuperviser: WorkflowSuperviserService | null = null;
  workflowWorker: WorkflowWorkerService | null = null;
  actorService: ActorService | null = null;
  subscribers = new Set<TSubscriber>();
  refreshTimer: Timer | null = null;

  constructor(initialScenarioId?: string) {
    this.scenario = getScenario(initialScenarioId);
  }

  async start(): Promise<void> {
    if (process.env.VIBECANVAS_VISUALIZER_SOURCE === 'db') await this.loadDbState();
    else await this.loadScenario(this.scenario.id);
  }

  async loadScenario(scenarioId: string): Promise<void> {
    await this.stopServices();
    this.sourceMode = 'scenario';
    this.selectedCanvasId = null;
    this.dbPath = null;
    this.scenario = getScenario(scenarioId);
    this.dbService = new DbServiceBunSqlite({ databasePath: ':memory:', dataDir: '/tmp/vibecanvas-visualizer', cacheDir: '/tmp/vibecanvas-visualizer-cache', silentMigrations: true });
    await this.dbService.start();
    this.dbService.account.ensureDefaultOwner();
    this.workflowDb = new SqliteWorkflowDb({ db: this.dbService.drizzle, randomId: () => id('workflow') });
    this.workflowSuperviser = new WorkflowSuperviserService({ db: this.workflowDb });
    this.workflowWorker = new WorkflowWorkerService({
      db: this.workflowDb,
      workerId: 'visualizer-worker',
      sandboxName: 'visualizer-in-process-sandbox',
      runStepInSandbox: async ({ step, previousResults }) => {
        const args = step.args as { readonly state: string; readonly context: TWorkflowJson; readonly message: { readonly name: string; readonly payload: TWorkflowJson } };
        const fn = this.scenario.effects[step.functionName];
        if (!fn) throw new Error(`Scenario "${this.scenario.id}" does not implement ${step.functionName}`);
        const context = mergeEffectResults(args.context, previousResults);
        return await fn({ ...args, context }) as TVisualizerEffectResult;
      },
      leaseMs: 30_000,
      pollIntervalMs: 500,
    });
    this.actorService = new ActorService({ db: this.dbService.drizzle, workflowDb: this.workflowDb, autoStart: false, startSandbox: false, workerId: 'visualizer-actor-supervisor', pollIntervalMs: 500 });
    this.seedScenario(this.scenario);
    await this.actorService.start({ config: { actorService: { autoStart: false, startSandbox: false } } });
    this.publish();
  }

  async loadDbState(canvasId?: string | null): Promise<void> {
    await this.stopServices();
    const config = resolveDevDbConfig();
    this.sourceMode = 'db';
    this.dbPath = config.databasePath;
    this.selectedCanvasId = canvasId ?? null;
    this.dbService = new DbServiceBunSqlite({ ...config, silentMigrations: true });
    await this.dbService.start();
    this.dbService.account.ensureDefaultOwner();
    this.refreshTimer = setInterval(() => this.publish(), 1_500);
    this.publish();
  }

  async selectDbCanvas(canvasId: string | null): Promise<void> {
    if (this.sourceMode !== 'db') return;
    this.selectedCanvasId = canvasId;
    this.publish();
  }

  async stopServices(): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    this.workflowWorker?.stop();
    await this.actorService?.stop().catch(() => undefined);
    await this.dbService?.stop().catch(() => undefined);
    this.workflowDb = null;
    this.workflowSuperviser = null;
    this.workflowWorker = null;
    this.actorService = null;
    this.dbService = null;
  }

  async sendMessage(actorInstanceId: string, eventName: string, payload: TWorkflowJson): Promise<void> {
    const db = this.requireDb();
    const actor = db.query.actor_instances.findFirst({ where: eq(schema.actor_instances.id, actorInstanceId) }).sync();
    if (!actor) throw new Error(`Unknown actor ${actorInstanceId}`);
    const rows = db.select().from(schema.actor_inbox).all().filter((row) => row.actor_instance_id === actorInstanceId);
    const seq = rows.reduce((max, row) => Math.max(max, row.seq), 0) + 1;
    const messageId = id('message');
    db.insert(schema.actor_inbox).values({
      id: id('inbox'),
      workspace_id: actor.workspace_id,
      canvas_id: actor.canvas_id,
      actor_instance_id: actor.id,
      seq,
      message_id: messageId,
      correlation_id: messageId,
      causation_id: null,
      idempotency_key: `manual:${messageId}`,
      source_actor_instance_id: null,
      source_output_id: null,
      connection_id: null,
      event_name: eventName,
      params: payload,
      status: 'queued',
      created_at: new Date(),
    }).run();
    this.publish();
  }

  async tick(): Promise<unknown> {
    if (this.sourceMode === 'db') {
      this.publish();
      return serialize({ status: 'refreshed' });
    }
    const actorResultA = await this.actorService?.supervisor.runOnce();
    const workerResult = await this.workflowWorker?.runOnce();
    const actorResultB = await this.actorService?.supervisor.runOnce();
    const result = { actorResultA, workerResult, actorResultB };
    this.publish();
    return serialize(result);
  }

  async drain(limit = 50): Promise<unknown> {
    if (this.sourceMode === 'db') {
      this.publish();
      return serialize({ status: 'refreshed' });
    }
    const steps: unknown[] = [];
    for (let i = 0; i < limit; i += 1) {
      const actorResultA = await this.actorService?.supervisor.runOnce();
      const workerResult = await this.workflowWorker?.runOnce();
      const actorResultB = await this.actorService?.supervisor.runOnce();
      steps.push({ actorResultA, workerResult, actorResultB });
      const idle = actorResultA?.status === 'idle' && workerResult?.status === 'idle' && actorResultB?.status === 'idle';
      if (idle) break;
    }
    this.publish();
    return serialize({ steps });
  }

  snapshot(): unknown {
    return this.sourceMode === 'db' ? this.dbSnapshot() : this.scenarioSnapshot();
  }

  subscribe(fn: TSubscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  publish(): void {
    const snapshot = this.snapshot();
    for (const subscriber of this.subscribers) subscriber(snapshot);
  }

  private scenarioSnapshot(): unknown {
    const data = this.buildDbBackedSnapshot({
      title: this.scenario.name,
      description: this.scenario.description,
      explainer: this.scenario.explainer,
      actorPosition: (instance, index) => {
        const seed = this.scenario.actors.find((actor) => actor.id === instance.id);
        return seed ? { x: seed.x, y: seed.y } : fallbackPosition(index);
      },
    });
    return serialize({
      ...data,
      scenario: { id: this.scenario.id, name: this.scenario.name, description: this.scenario.description, explainer: this.scenario.explainer },
      scenarioOptions: VISUALIZER_SCENARIOS.map((scenario) => ({ id: scenario.id, name: scenario.name, description: scenario.description })),
      source: { mode: this.sourceMode, dbPath: null, canvasId: null },
      canvasOptions: [],
      status: { actorService: this.actorService?.getStatus(), workflowWorker: this.workflowWorker?.getStatus() },
    });
  }

  private dbSnapshot(): unknown {
    const db = this.requireDb();
    const canvases = db.select().from(schema.canvas).all();
    const selectedCanvas = canvases.find((canvas) => canvas.id === this.selectedCanvasId) ?? null;
    const title = selectedCanvas ? `DB: ${selectedCanvas.name}` : 'DB: all canvases';
    const data = this.buildDbBackedSnapshot({
      title,
      description: this.dbPath ? `Live actor rows from ${this.dbPath}` : 'Live actor rows from the Vibecanvas database',
      explainer: null,
      actorPosition: (instance, index) => {
        const revision = db.query.actor_revisions.findFirst({ where: eq(schema.actor_revisions.id, instance.actor_revision_id) }).sync();
        return positionFromManifest(revision?.ui_manifest) ?? fallbackPosition(index);
      },
    });
    return serialize({
      ...data,
      scenario: { id: 'db', name: title, description: this.dbPath ?? '', explainer: null },
      scenarioOptions: VISUALIZER_SCENARIOS.map((scenario) => ({ id: scenario.id, name: scenario.name, description: scenario.description })),
      source: { mode: this.sourceMode, dbPath: this.dbPath, canvasId: this.selectedCanvasId },
      canvasOptions: [
        { id: '', name: 'All canvases', actorCount: db.select().from(schema.actor_instances).all().length },
        ...canvases.map((canvas) => ({ id: canvas.id, name: canvas.name, actorCount: this.countActorsForCanvas(canvas.id) })),
      ],
      status: { actorService: null, workflowWorker: null },
    });
  }

  private buildDbBackedSnapshot(args: {
    readonly title: string;
    readonly description: string;
    readonly explainer: unknown;
    readonly actorPosition: (instance: typeof schema.actor_instances.$inferSelect, index: number) => TActorPosition;
  }) {
    const db = this.requireDb();
    const canvasId = this.sourceMode === 'db' ? this.selectedCanvasId : this.scenario.canvasId;
    const filterByCanvas = <T extends { readonly canvas_id?: string | null }>(rows: T[]) => canvasId ? rows.filter((row) => row.canvas_id === canvasId) : rows;
    const instances = filterByCanvas(db.select().from(schema.actor_instances).all());
    const actorIds = new Set(instances.map((instance) => instance.id));
    const actors = instances.map((instance, index) => {
      const workflowRun = instance.workflow_run_id ? db.query.workflow_runs.findFirst({ where: eq(schema.workflow_runs.id, instance.workflow_run_id) }).sync() : null;
      const workflowRuns = db.select().from(schema.workflow_runs).all()
        .filter((run) => run.subject_id === instance.id)
        .sort((a, b) => a.started_at.getTime() - b.started_at.getTime());
      const workflowRunIds = new Set(workflowRuns.map((run) => run.id));
      const workflowSteps = db.select().from(schema.workflow_steps).all()
        .filter((step) => workflowRunIds.has(step.workflow_run_id))
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.step_index - b.step_index);
      return {
        ...instance,
        ...args.actorPosition(instance, index),
        inbox: db.select().from(schema.actor_inbox).all().filter((row) => row.actor_instance_id === instance.id).sort((a, b) => a.seq - b.seq),
        outputs: db.select().from(schema.actor_outputs).all().filter((row) => row.actor_instance_id === instance.id).sort((a, b) => a.seq - b.seq),
        workflowRun,
        workflowRuns,
        workflowSteps,
      };
    });

    return {
      title: args.title,
      description: args.description,
      explainer: args.explainer,
      actors,
      connections: filterByCanvas(db.select().from(schema.actor_connections).all()).filter((connection) => actorIds.has(connection.source_actor_instance_id) && actorIds.has(connection.target_actor_instance_id)),
      global: {
        workflowRuns: filterByCanvas(db.select().from(schema.workflow_runs).all()),
        workflowSteps: db.select().from(schema.workflow_steps).all(),
        sandboxRuns: db.select().from(schema.sandbox_runs).all(),
        inbox: filterByCanvas(db.select().from(schema.actor_inbox).all()),
        outputs: filterByCanvas(db.select().from(schema.actor_outputs).all()),
      },
    };
  }

  private countActorsForCanvas(canvasId: string): number {
    const db = this.requireDb();
    return db.select().from(schema.actor_instances).all().filter((row) => row.canvas_id === canvasId).length;
  }

  private seedScenario(scenarioToSeed: TVisualizerScenario): void {
    const db = this.requireDb();
    db.insert(schema.canvas).values({ id: scenarioToSeed.canvasId, name: scenarioToSeed.name, automerge_url: `visualizer://${scenarioToSeed.id}`, created_at: new Date() }).run();
    for (const actor of scenarioToSeed.actors) {
      db.insert(schema.actor_definitions).values({ id: actor.definitionId, name: actor.displayName, slug: actor.definitionId, description: `Visualizer actor ${actor.displayName}`, current_revision_id: actor.revisionId, created_at: new Date() }).run();
      db.insert(schema.actor_revisions).values({
        id: actor.revisionId,
        actor_definition_id: actor.definitionId,
        version: 'visualizer',
        revision_hash: `${scenarioToSeed.id}:${actor.id}`,
        machine_schema: {},
        machine_config: actor.machineConfig,
        contract_schema: {},
        output_schema: {},
        server_manifest: actor.serverManifest ?? { entrypoint: 'visualizer-scenario.ts', functions: { fns: Object.keys(scenarioToSeed.effects).filter((name) => name.startsWith('fn.')), fxs: Object.keys(scenarioToSeed.effects).filter((name) => name.startsWith('fx.')), txs: Object.keys(scenarioToSeed.effects).filter((name) => name.startsWith('tx.')) } },
        ui_manifest: { x: actor.x, y: actor.y },
        created_at: new Date(),
      }).run();
      db.insert(schema.actor_instances).values({
        id: actor.id,
        canvas_id: scenarioToSeed.canvasId,
        element_id: actor.elementId,
        actor_definition_id: actor.definitionId,
        actor_revision_id: actor.revisionId,
        display_name: actor.displayName,
        status: 'created',
        machine_state: actor.initialState,
        machine_context: actor.initialContext,
        created_at: new Date(),
      }).run();
    }
    for (const connection of scenarioToSeed.connections) {
      db.insert(schema.actor_connections).values({
        id: connection.id,
        canvas_id: scenarioToSeed.canvasId,
        source_element_id: scenarioToSeed.actors.find((actor) => actor.id === connection.sourceActorId)?.elementId ?? connection.sourceActorId,
        source_actor_instance_id: connection.sourceActorId,
        target_element_id: scenarioToSeed.actors.find((actor) => actor.id === connection.targetActorId)?.elementId ?? connection.targetActorId,
        target_actor_instance_id: connection.targetActorId,
        enabled: true,
        label: connection.label ?? null,
        event_name_whitelist: connection.outputName ? [connection.outputName] : null,
        style: {},
        created_at: new Date(),
      }).run();
    }
  }

  private requireDb() {
    if (!this.dbService) throw new Error('Visualizer runtime has not started');
    return this.dbService.drizzle;
  }
}
