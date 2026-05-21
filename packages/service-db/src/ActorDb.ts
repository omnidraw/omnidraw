import { and, asc, eq, gt, inArray, or } from 'drizzle-orm';
import { DEFAULT_OSS_ACCOUNT_ID } from './CONSTANTS';
import type { TDrizzleDb } from './DbServiceBunSqlite/index';
import * as schema from './schema';
import type { TActorConnection, TActorDefinition, TActorInbox, TActorInstance, TActorOutput, TCanvasMemberRole } from './model';

export type TActorMessage = { readonly name: string; readonly payload: unknown };

export type TInsertActorInboxArgs = {
  readonly workspaceId?: string | null;
  readonly canvasId: string;
  readonly actorInstanceId: string;
  readonly seq: number;
  readonly messageId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly idempotencyKey: string;
  readonly sourceActorInstanceId?: string;
  readonly sourceOutputId?: string;
  readonly connectionId?: string;
  readonly message: TActorMessage;
  readonly createdAt: Date;
};

export type TInsertActorOutputArgs = {
  readonly instance: TActorInstance;
  readonly seq: number;
  readonly outputId: string;
  readonly messageId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly output: TActorMessage;
  readonly machineState: string;
  readonly workflowRunId?: string;
  readonly workflowStepId?: string;
  readonly createdAt: Date;
};

export type TUpsertActorDefinitionArgs = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly version: number;
  readonly description: string | null;
  readonly functionsPath: string;
  readonly machineConfig: unknown;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
  readonly serverManifest: unknown;
  readonly widgetConfig: unknown;
};

export class ActorDb {
  constructor(private readonly db: TDrizzleDb, private readonly idFactory: () => string = () => crypto.randomUUID()) {}

  accountId(accountId?: string): string { return accountId ?? DEFAULT_OSS_ACCOUNT_ID; }

  hasCanvasRole(args: { canvasId: string; accountId?: string; roles: TCanvasMemberRole[] }): boolean {
    return this.db.query.canvas_members.findFirst({
      where: and(
        eq(schema.canvas_members.canvas_id, args.canvasId),
        eq(schema.canvas_members.account_id, this.accountId(args.accountId)),
        inArray(schema.canvas_members.role, args.roles),
      ),
    }).sync() !== undefined;
  }

  canViewCanvas(args: { canvasId: string; accountId?: string }): boolean { return this.hasCanvasRole({ ...args, roles: ['owner', 'editor', 'viewer'] }); }
  canEditCanvas(args: { canvasId: string; accountId?: string }): boolean { return this.hasCanvasRole({ ...args, roles: ['owner', 'editor'] }); }

  canListActorDefinitions(args: { accountId?: string }): boolean {
    return this.db.query.accounts.findFirst({ where: eq(schema.accounts.id, this.accountId(args.accountId)) }).sync() !== undefined;
  }

  listCanvases(): { id: string; name: string; automerge_url: string; created_at: Date }[] {
    return this.db.select().from(schema.canvas).all();
  }

  insertCanvas(args: { id: string; name: string; automerge_url: string; created_at?: Date }): void {
    this.db.insert(schema.canvas).values(args).run();
  }

  listWorkflowRuns(): unknown[] { return this.db.select().from(schema.workflow_runs).all(); }
  listWorkflowSteps(): unknown[] { return this.db.select().from(schema.workflow_steps).all(); }
  listSandboxRuns(): unknown[] { return this.db.select().from(schema.sandbox_runs).all(); }

  insertActorDefinitionRow(args: Omit<TActorDefinition, 'created_at' | 'updated_at'> & { created_at?: Date; updated_at?: Date }): void {
    this.db.insert(schema.actor_definitions).values(args as never).run();
  }

  insertActorInstanceRow(args: Omit<TActorInstance, 'workspace_id' | 'workflow_run_id' | 'created_by_system_id' | 'created_at'> & Partial<Pick<TActorInstance, 'workspace_id' | 'workflow_run_id' | 'created_by_system_id' | 'created_at'>>): void {
    this.db.insert(schema.actor_instances).values(args as never).run();
  }

  insertActorConnectionRow(args: Omit<TActorConnection, 'created_by_system_id' | 'created_at'> & Partial<Pick<TActorConnection, 'created_by_system_id' | 'created_at'>>): void {
    this.db.insert(schema.actor_connections).values(args as never).run();
  }

  listActorDefinitions(args: { slug?: string } = {}) {
    return this.db.query.actor_definitions.findMany({
      where: args.slug ? eq(schema.actor_definitions.slug, args.slug) : undefined,
      orderBy: [asc(schema.actor_definitions.name), asc(schema.actor_definitions.slug), asc(schema.actor_definitions.id)],
    }).sync() as TActorDefinition[];
  }

  getActorDefinition(id: string): TActorDefinition | null {
    return this.db.query.actor_definitions.findFirst({ where: eq(schema.actor_definitions.id, id) }).sync() as TActorDefinition | undefined ?? null;
  }

  getActorDefinitionBySlug(slug: string): TActorDefinition | null {
    return this.db.query.actor_definitions.findFirst({ where: eq(schema.actor_definitions.slug, slug) }).sync() as TActorDefinition | undefined ?? null;
  }

  upsertActorDefinition(args: TUpsertActorDefinitionArgs): void {
    this.db.insert(schema.actor_definitions).values({
      id: args.id,
      name: args.name,
      slug: args.slug,
      version: args.version,
      description: args.description,
      functions_path: args.functionsPath,
      machine_config: args.machineConfig,
      input_schema: args.inputSchema,
      output_schema: args.outputSchema,
      server_manifest: args.serverManifest,
      widget_config: args.widgetConfig,
      updated_at: new Date(),
    }).onConflictDoUpdate({
      target: schema.actor_definitions.slug,
      set: {
        name: args.name,
        version: args.version,
        description: args.description,
        functions_path: args.functionsPath,
        machine_config: args.machineConfig,
        input_schema: args.inputSchema,
        output_schema: args.outputSchema,
        server_manifest: args.serverManifest,
        widget_config: args.widgetConfig,
        updated_at: new Date(),
      },
    }).run();
  }

  listActorInstances(args: { canvasId?: string } = {}): TActorInstance[] {
    return this.db.query.actor_instances.findMany({
      where: args.canvasId ? eq(schema.actor_instances.canvas_id, args.canvasId) : undefined,
      orderBy: [asc(schema.actor_instances.created_at), asc(schema.actor_instances.id)],
    }).sync() as TActorInstance[];
  }

  getActorInstance(id: string): TActorInstance | null {
    return this.db.query.actor_instances.findFirst({ where: eq(schema.actor_instances.id, id) }).sync() as TActorInstance | undefined ?? null;
  }

  getActorInstanceByElement(args: { canvasId: string; elementId: string }): TActorInstance | null {
    return this.db.query.actor_instances.findFirst({ where: and(eq(schema.actor_instances.canvas_id, args.canvasId), eq(schema.actor_instances.element_id, args.elementId)) }).sync() as TActorInstance | undefined ?? null;
  }

  createActorInstance(args: { input: { canvasId: string; elementId: string; actorDefinitionId: string; displayName?: string; initialState?: string; initialContext?: unknown }; accountId?: string; machineState: string; machineContext: unknown }): TActorInstance | null {
    const definition = this.getActorDefinition(args.input.actorDefinitionId);
    if (!definition) return null;
    return this.db.insert(schema.actor_instances).values({
      id: this.idFactory(),
      canvas_id: args.input.canvasId,
      element_id: args.input.elementId,
      actor_definition_id: definition.id,
      display_name: args.input.displayName ?? definition.name,
      machine_state: args.machineState,
      machine_context: args.machineContext,
      created_by_system_id: args.accountId ?? 'system',
    }).returning().all()[0] as TActorInstance;
  }

  patchActorInstance(id: string, patch: Partial<Omit<TActorInstance, 'id'>>): TActorInstance {
    this.db.update(schema.actor_instances).set(patch as never).where(eq(schema.actor_instances.id, id)).run();
    const row = this.getActorInstance(id);
    if (!row) throw new Error(`Unknown actor instance "${id}"`);
    return row;
  }

  deleteActorInstance(id: string): TActorInstance | null {
    return this.db.delete(schema.actor_instances).where(eq(schema.actor_instances.id, id)).returning().all()[0] as TActorInstance | undefined ?? null;
  }

  listActorConnections(args: { canvasId?: string } = {}): TActorConnection[] {
    return this.db.query.actor_connections.findMany({
      where: args.canvasId ? eq(schema.actor_connections.canvas_id, args.canvasId) : undefined,
      orderBy: [asc(schema.actor_connections.created_at), asc(schema.actor_connections.id)],
    }).sync() as TActorConnection[];
  }

  getActorConnection(id: string): TActorConnection | null {
    return this.db.query.actor_connections.findFirst({ where: eq(schema.actor_connections.id, id) }).sync() as TActorConnection | undefined ?? null;
  }

  createActorConnection(args: { input: { id?: string; canvasId: string; sourceElementId: string; sourceActorInstanceId?: string; targetElementId: string; targetActorInstanceId?: string; label?: string | null; eventNameWhitelist?: readonly string[] | null; style?: unknown }; accountId?: string }): TActorConnection | null {
    const source = args.input.sourceActorInstanceId ? this.getActorInstance(args.input.sourceActorInstanceId) : this.getActorInstanceByElement({ canvasId: args.input.canvasId, elementId: args.input.sourceElementId });
    const target = args.input.targetActorInstanceId ? this.getActorInstance(args.input.targetActorInstanceId) : this.getActorInstanceByElement({ canvasId: args.input.canvasId, elementId: args.input.targetElementId });
    if (!source || !target) return null;
    if (source.canvas_id !== args.input.canvasId || target.canvas_id !== args.input.canvasId) return null;
    if (source.element_id !== args.input.sourceElementId || target.element_id !== args.input.targetElementId) return null;
    return this.db.insert(schema.actor_connections).values({
      id: args.input.id ?? this.idFactory(),
      canvas_id: args.input.canvasId,
      source_element_id: args.input.sourceElementId,
      source_actor_instance_id: source.id,
      target_element_id: args.input.targetElementId,
      target_actor_instance_id: target.id,
      label: args.input.label ?? null,
      event_name_whitelist: args.input.eventNameWhitelist ?? null,
      style: args.input.style ?? {},
      created_by_system_id: args.accountId ?? 'system',
    }).returning().all()[0] as TActorConnection;
  }

  updateActorConnection(args: { id: string; patch: { enabled?: boolean; label?: string | null; eventNameWhitelist?: readonly string[] | null; style?: unknown } }): TActorConnection | null {
    const existing = this.getActorConnection(args.id);
    if (!existing) return null;
    const set = {
      ...(args.patch.enabled !== undefined ? { enabled: args.patch.enabled } : {}),
      ...(args.patch.label !== undefined ? { label: args.patch.label } : {}),
      ...(args.patch.eventNameWhitelist !== undefined ? { event_name_whitelist: args.patch.eventNameWhitelist } : {}),
      ...(args.patch.style !== undefined ? { style: args.patch.style } : {}),
    };
    if (Object.keys(set).length === 0) return existing;
    return this.db.update(schema.actor_connections).set(set).where(eq(schema.actor_connections.id, args.id)).returning().all()[0] as TActorConnection;
  }

  removeActorConnection(id: string): TActorConnection | null {
    return this.db.delete(schema.actor_connections).where(eq(schema.actor_connections.id, id)).returning().all()[0] as TActorConnection | undefined ?? null;
  }

  deleteActorConnectionsForInstance(actorInstanceId: string): TActorConnection[] {
    return this.db.delete(schema.actor_connections).where(or(eq(schema.actor_connections.source_actor_instance_id, actorInstanceId), eq(schema.actor_connections.target_actor_instance_id, actorInstanceId))).returning().all() as TActorConnection[];
  }

  deleteActorInboxForInstance(actorInstanceId: string): void {
    this.db.delete(schema.actor_inbox).where(or(eq(schema.actor_inbox.actor_instance_id, actorInstanceId), eq(schema.actor_inbox.source_actor_instance_id, actorInstanceId))).run();
  }

  listActorOutputs(args: { actorInstanceId: string; afterSeq?: number }): TActorOutput[] {
    const where = args.afterSeq === undefined ? eq(schema.actor_outputs.actor_instance_id, args.actorInstanceId) : and(eq(schema.actor_outputs.actor_instance_id, args.actorInstanceId), gt(schema.actor_outputs.seq, args.afterSeq));
    return this.db.query.actor_outputs.findMany({ where, orderBy: [asc(schema.actor_outputs.seq), asc(schema.actor_outputs.id)] }).sync() as TActorOutput[];
  }

  getActorRows(actorInstanceId: string): { instance: TActorInstance; definition: TActorDefinition } {
    const instance = this.getActorInstance(actorInstanceId);
    if (!instance) throw new Error(`Unknown actor instance "${actorInstanceId}"`);
    const definition = this.getActorDefinition(instance.actor_definition_id);
    if (!definition) throw new Error(`Unknown actor definition "${instance.actor_definition_id}"`);
    return { instance, definition };
  }

  nextQueuedInbox(): TActorInbox | undefined {
    return this.db.query.actor_inbox.findMany({ where: eq(schema.actor_inbox.status, 'queued'), orderBy: [asc(schema.actor_inbox.created_at), asc(schema.actor_inbox.seq)] }).sync()[0] as TActorInbox | undefined;
  }

  listClaimedInbox(): TActorInbox[] { return this.db.query.actor_inbox.findMany({ where: eq(schema.actor_inbox.status, 'claimed') }).sync() as TActorInbox[]; }

  listInboxForActor(actorInstanceId: string): TActorInbox[] { return this.db.query.actor_inbox.findMany({ where: eq(schema.actor_inbox.actor_instance_id, actorInstanceId) }).sync() as TActorInbox[]; }

  hasBootInbox(actorInstanceId: string, bootMessageName: string): boolean {
    return this.listInboxForActor(actorInstanceId).some((row) => row.event_name === bootMessageName);
  }

  findInbox(id: string): TActorInbox {
    const row = this.db.query.actor_inbox.findFirst({ where: eq(schema.actor_inbox.id, id) }).sync() as TActorInbox | undefined;
    if (!row) throw new Error(`Unknown actor inbox "${id}"`);
    return row;
  }

  claimInbox(inbox: TActorInbox, workerId: string): TActorInbox {
    this.db.update(schema.actor_inbox).set({ status: 'claimed', claimed_by_run_id: workerId, attempt: inbox.attempt + 1 }).where(eq(schema.actor_inbox.id, inbox.id)).run();
    return this.findInbox(inbox.id);
  }

  patchInbox(id: string, patch: Partial<Omit<TActorInbox, 'id'>>): TActorInbox {
    this.db.update(schema.actor_inbox).set(patch as never).where(eq(schema.actor_inbox.id, id)).run();
    return this.findInbox(id);
  }

  insertInbox(args: TInsertActorInboxArgs): TActorInbox {
    return this.db.insert(schema.actor_inbox).values({
      id: this.idFactory(), workspace_id: args.workspaceId ?? null, canvas_id: args.canvasId, actor_instance_id: args.actorInstanceId,
      seq: args.seq, message_id: args.messageId, correlation_id: args.correlationId, causation_id: args.causationId ?? null,
      idempotency_key: args.idempotencyKey, source_actor_instance_id: args.sourceActorInstanceId ?? null, source_output_id: args.sourceOutputId ?? null,
      connection_id: args.connectionId ?? null, event_name: args.message.name, params: args.message.payload, status: 'queued', attempt: 0, created_at: args.createdAt,
    }).returning().all()[0] as TActorInbox;
  }

  nextActorInboxSeq(actorInstanceId: string): number {
    return this.listInboxForActor(actorInstanceId).reduce((max, row) => Math.max(max, row.seq), 0) + 1;
  }

  nextActorOutputSeq(actorInstanceId: string): number {
    const rows = this.db.query.actor_outputs.findMany({ where: eq(schema.actor_outputs.actor_instance_id, actorInstanceId) }).sync() as TActorOutput[];
    return rows.reduce((max, row) => Math.max(max, row.seq), 0) + 1;
  }

  insertOutput(args: TInsertActorOutputArgs): TActorOutput {
    return this.db.insert(schema.actor_outputs).values({
      id: this.idFactory(), workspace_id: args.instance.workspace_id, canvas_id: args.instance.canvas_id, actor_instance_id: args.instance.id,
      seq: args.seq, output_id: args.outputId, message_id: args.messageId, correlation_id: args.correlationId, causation_id: args.causationId ?? null,
      output_name: args.output.name, payload: args.output.payload, machine_state: args.machineState, workflow_run_id: args.workflowRunId ?? null,
      workflow_step_id: args.workflowStepId ?? null, commit_status: 'committed', created_at: args.createdAt,
    }).returning().all()[0] as TActorOutput;
  }

  listOutputConnections(args: { actorInstanceId: string; outputName: string }): TActorConnection[] {
    return this.db.query.actor_connections.findMany({ where: and(eq(schema.actor_connections.source_actor_instance_id, args.actorInstanceId), eq(schema.actor_connections.enabled, true)) }).sync()
      .filter((connection) => {
        const whitelist = connection.event_name_whitelist as readonly string[] | null;
        return !whitelist || whitelist.length === 0 || whitelist.includes(args.outputName);
      }) as TActorConnection[];
  }
}
