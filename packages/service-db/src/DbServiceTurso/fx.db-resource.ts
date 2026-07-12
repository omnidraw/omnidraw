import type { Database } from "@tursodatabase/database"
import type {
  TActorInstance,
  TDbResourceMigrationBlock,
  TDbResourceConfiguration,
  TDbResourceMigrationStatus,
  TDbResourceSchema,
  TDbResourceSchemaMigration,
  TDbResourceSchemaStatus,
} from "../model"
import { fnParseActorInstanceRow, fnParseDbResourceMigrationBlockRow } from "./fn.actor-resource-row"

type TPortal = {
  db: Database
}

type TArgsSchemaGet = {
  id: string
}

type TArgsSchemaList = {
  status?: TDbResourceSchemaStatus
}

type TArgsMigrationGet = {
  schemaId: string
  version: number
}

type TArgsMigrationList = {
  schemaId: string
  status?: TDbResourceMigrationStatus
  throughVersion?: number
}

type TArgsConfigurationGet = {
  resourceId: string
}

type TArgsConfigurationList = {
  schemaId?: string
}

type TArgsMigrationBlockListByResource = {
  resourceId: string
}

type TArgsMigrationBlockListByInstance = {
  actorInstanceId: string
}

export async function fxDbResourceSchemaGet(portal: TPortal, args: TArgsSchemaGet): Promise<TDbResourceSchema | null> {
  const row = await (await portal.db.prepare(`
    SELECT *
    FROM db_resource_schemas
    WHERE id = ?
  `)).get(args.id)
  return (row ?? null) as TDbResourceSchema | null
}

export async function fxDbResourceSchemaList(portal: TPortal, args: TArgsSchemaList): Promise<TDbResourceSchema[]> {
  const rows = args.status === undefined
    ? await (await portal.db.prepare(`
        SELECT *
        FROM db_resource_schemas
        ORDER BY created_at ASC, id ASC
      `)).all()
    : await (await portal.db.prepare(`
        SELECT *
        FROM db_resource_schemas
        WHERE status = ?
        ORDER BY created_at ASC, id ASC
      `)).all(args.status)
  return rows as TDbResourceSchema[]
}

export async function fxDbResourceMigrationGet(
  portal: TPortal,
  args: TArgsMigrationGet,
): Promise<TDbResourceSchemaMigration | null> {
  const row = await (await portal.db.prepare(`
    SELECT *
    FROM db_resource_schema_migrations
    WHERE schema_id = ? AND version = ?
  `)).get(args.schemaId, args.version)
  return (row ?? null) as TDbResourceSchemaMigration | null
}

export async function fxDbResourceMigrationList(
  portal: TPortal,
  args: TArgsMigrationList,
): Promise<TDbResourceSchemaMigration[]> {
  let rows: unknown[]
  if (args.status !== undefined && args.throughVersion !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_schema_migrations
      WHERE schema_id = ? AND status = ? AND version <= ?
      ORDER BY version ASC
    `)).all(args.schemaId, args.status, args.throughVersion)
  } else if (args.status !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_schema_migrations
      WHERE schema_id = ? AND status = ?
      ORDER BY version ASC
    `)).all(args.schemaId, args.status)
  } else if (args.throughVersion !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_schema_migrations
      WHERE schema_id = ? AND version <= ?
      ORDER BY version ASC
    `)).all(args.schemaId, args.throughVersion)
  } else {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_schema_migrations
      WHERE schema_id = ?
      ORDER BY version ASC
    `)).all(args.schemaId)
  }
  return rows as TDbResourceSchemaMigration[]
}

export async function fxDbResourceConfigurationGet(
  portal: TPortal,
  args: TArgsConfigurationGet,
): Promise<TDbResourceConfiguration | null> {
  const row = await (await portal.db.prepare(`
    SELECT *
    FROM db_resource_configurations
    WHERE resource_id = ?
  `)).get(args.resourceId)
  return (row ?? null) as TDbResourceConfiguration | null
}

export async function fxDbResourceConfigurationList(
  portal: TPortal,
  args: TArgsConfigurationList,
): Promise<TDbResourceConfiguration[]> {
  const rows = args.schemaId === undefined
    ? await (await portal.db.prepare(`
        SELECT *
        FROM db_resource_configurations
        ORDER BY created_at ASC, resource_id ASC
      `)).all()
    : await (await portal.db.prepare(`
        SELECT *
        FROM db_resource_configurations
        WHERE schema_id = ?
        ORDER BY created_at ASC, resource_id ASC
      `)).all(args.schemaId)
  return rows as TDbResourceConfiguration[]
}

export async function fxDbResourceMigrationBlockListByResource(
  portal: TPortal,
  args: TArgsMigrationBlockListByResource,
): Promise<TDbResourceMigrationBlock[]> {
  const rows = await (await portal.db.prepare(`
    SELECT *
    FROM db_resource_migration_blocks
    WHERE resource_id = ?
    ORDER BY actor_instance_id ASC
  `)).all(args.resourceId)
  return rows.map(fnParseDbResourceMigrationBlockRow)
}

export async function fxDbResourceMigrationBlockListByInstance(
  portal: TPortal,
  args: TArgsMigrationBlockListByInstance,
): Promise<TDbResourceMigrationBlock[]> {
  const rows = await (await portal.db.prepare(`
    SELECT *
    FROM db_resource_migration_blocks
    WHERE actor_instance_id = ?
    ORDER BY resource_id ASC
  `)).all(args.actorInstanceId)
  return rows.map(fnParseDbResourceMigrationBlockRow)
}

export async function fxDbResourceListAffectedInstances(
  portal: TPortal,
  args: TArgsMigrationBlockListByResource,
): Promise<TActorInstance[]> {
  const rows = await (await portal.db.prepare(`
    SELECT DISTINCT actor_instances.*
    FROM actor_instances
    INNER JOIN actor_resource_bindings
      ON actor_resource_bindings.actor_definition_name = actor_instances.actor_definition_name
    WHERE actor_resource_bindings.resource_id = ?
    ORDER BY actor_instances.created_at ASC, actor_instances.id ASC
  `)).all(args.resourceId)
  return rows.map(fnParseActorInstanceRow)
}
