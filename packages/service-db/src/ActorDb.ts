import { and, eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';

type TDb = BunSQLiteDatabase<typeof schema>;
type TActorDefinition = typeof schema.actor_definitions.$inferSelect;
type TActorDefinitionInsert = typeof schema.actor_definitions.$inferInsert;
type TActorInstance = typeof schema.actor_instances.$inferSelect;
type TActorInstanceInsert = typeof schema.actor_instances.$inferInsert;
type TActorConnection = typeof schema.actor_connections.$inferSelect;
type TActorConnectionInsert = typeof schema.actor_connections.$inferInsert;
type TJson = Record<string, unknown> | unknown[];

type TActorInstanceCreateArgs = Omit<TActorInstanceInsert, 'actor_definition_id' | 'machine_context'> & {
  actor_definition_id?: string;
  actor_definition_name?: string;
  machine_context: TJson;
};

type TActorConnectionCreateArgs = Omit<TActorConnectionInsert, 'style'> & {
  msg_name_whitelist?: string | null;
  style: TJson;
};

export class ActorDb {
  constructor(private readonly db: TDb) {}

  listDefinitions(): TActorDefinition[] {
    return this.db.select().from(schema.actor_definitions).orderBy(schema.actor_definitions.name, schema.actor_definitions.slug).all();
  }

  getDefinition(name: string): TActorDefinition | null {
    return this.db.query.actor_definitions.findFirst({ where: eq(schema.actor_definitions.name, name) }).sync() ?? null;
  }

  insertDefinition(definition: TActorDefinitionInsert): TActorDefinition {
    return this.db.insert(schema.actor_definitions).values(definition).returning().get();
  }

  deleteDefinition(name: string): void {
    this.db.delete(schema.actor_definitions).where(eq(schema.actor_definitions.name, name)).run();
  }

  updateDefinition(definition: TActorDefinitionInsert): TActorDefinition {
    const row = this.db
      .update(schema.actor_definitions)
      .set(definition)
      .where(eq(schema.actor_definitions.id, definition.id))
      .returning()
      .get();
    if (!row) throw new Error(`Unknown actor definition "${definition.id}"`);
    return row;
  }

  reload(): void {}

  listInstances(filter?: { canvasId?: string }): TActorInstance[] {
    if (!filter?.canvasId) {
      return this.db.select().from(schema.actor_instances).orderBy(schema.actor_instances.created_at, schema.actor_instances.id).all();
    }

    return this.db
      .select()
      .from(schema.actor_instances)
      .where(eq(schema.actor_instances.canvas_id, filter.canvasId))
      .orderBy(schema.actor_instances.created_at, schema.actor_instances.id)
      .all();
  }

  getInstanceByElementId(elementId: string): TActorInstance | null {
    return this.db.query.actor_instances.findFirst({ where: eq(schema.actor_instances.element_id, elementId) }).sync() ?? null;
  }

  getInstanceById(instanceId: string): TActorInstance | null {
    return this.db.query.actor_instances.findFirst({ where: eq(schema.actor_instances.id, instanceId) }).sync() ?? null;
  }

  insertInstance(instance: TActorInstanceCreateArgs): TActorInstance {
    const actorDefinitionId = instance.actor_definition_id ?? this.getRequiredDefinitionId(instance.actor_definition_name);
    const { actor_definition_name: _actorDefinitionName, ...insert } = instance;

    return this.db
      .insert(schema.actor_instances)
      .values({ ...insert, actor_definition_id: actorDefinitionId })
      .returning()
      .get();
  }

  updateInstanceStatus(instance: Pick<TActorInstance, 'id' | 'status'>): TActorInstance {
    const row = this.db
      .update(schema.actor_instances)
      .set({ status: instance.status })
      .where(eq(schema.actor_instances.id, instance.id))
      .returning()
      .get();
    if (!row) throw new Error(`Unknown actor instance "${instance.id}"`);
    return row;
  }

  updateInstanceMachine(instance: Pick<TActorInstance, 'id' | 'machine_state'> & { machine_context: TJson }): TActorInstance {
    const row = this.db
      .update(schema.actor_instances)
      .set({ machine_state: instance.machine_state, machine_context: instance.machine_context })
      .where(eq(schema.actor_instances.id, instance.id))
      .returning()
      .get();
    if (!row) throw new Error(`Unknown actor instance "${instance.id}"`);
    return row;
  }

  deleteInstance(id: string): void {
    this.db.delete(schema.actor_instances).where(eq(schema.actor_instances.id, id)).run();
  }

  listConnections(): TActorConnection[] {
    return this.db.select().from(schema.actor_connections).orderBy(schema.actor_connections.created_at, schema.actor_connections.id).all();
  }

  insertConnection(connection: TActorConnectionCreateArgs): TActorConnection {
    const { msg_name_whitelist: _msgNameWhitelist, ...insert } = connection;
    return this.db.insert(schema.actor_connections).values(insert).returning().get();
  }

  deleteConnectionById(id: string): void {
    this.db.delete(schema.actor_connections).where(eq(schema.actor_connections.id, id)).run();
  }

  deleteConnectionBySource(actorId: string): void {
    this.db.delete(schema.actor_connections).where(eq(schema.actor_connections.source_actor_instance_id, actorId)).run();
  }

  private getRequiredDefinitionId(actorDefinitionName?: string): string {
    if (!actorDefinitionName) throw new Error('actor_definition_id or actor_definition_name is required');

    const row = this.db.query.actor_definitions.findFirst({
      where: eq(schema.actor_definitions.name, actorDefinitionName),
    }).sync();
    if (!row) throw new Error(`Unknown actor definition "${actorDefinitionName}"`);
    return row.id;
  }
}
