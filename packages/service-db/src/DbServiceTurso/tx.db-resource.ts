import type { Database } from "@tursodatabase/database"
import type {
  TDbResourceMigrationBlock,
  TDbResourceMigrationBlockReason,
  TDbResourceConfiguration,
  TDbResourceSchema,
  TDbResourceSchemaMigration,
} from "../model"
import { fnDbResourceAssertContiguousMigrations, fnDbResourceAssertVersions } from "./fn.db-resource"
import { fnParseDbResourceMigrationBlockRow } from "./fn.actor-resource-row"
import { fxActorResourceGet } from "./fx.actor-resource"
import {
  fxDbResourceConfigurationGet,
  fxDbResourceMigrationGet,
  fxDbResourceMigrationList,
  fxDbResourceSchemaGet,
} from "./fx.db-resource"

type TPortal = {
  db: Database
}

type TArgsSchemaCreate = {
  id: string
  name: string
  description?: string | null
}

type TArgsSchemaUpdateDraft = {
  id: string
  name: string
  description?: string | null
}

type TArgsSchemaId = {
  id: string
}

type TArgsMigrationCreateDraft = {
  schemaId: string
  version: number
  name: string
  sql: string
  checksum: string
}

type TArgsMigrationUpdateDraft = TArgsMigrationCreateDraft

type TArgsMigrationIdentity = {
  schemaId: string
  version: number
}

type TArgsConfigurationCreate = {
  resourceId: string
  schemaId: string
  appliedVersion?: number
  targetVersion?: number
}

type TArgsConfigurationSetTargetVersion = {
  resourceId: string
  targetVersion: number
}

type TArgsConfigurationSetVersions = {
  resourceId: string
  appliedVersion: number
  targetVersion: number
}

type TArgsMigrationBlockUpsert = {
  resourceId: string
  actorInstanceId: string
  reason: TDbResourceMigrationBlockReason
  restartWhenCompatible: boolean
  expectedSchemaId: string
  expectedVersion: number
  actualSchemaId: string
  actualVersion: number
}

type TArgsMigrationBlockRemove = {
  resourceId: string
  actorInstanceId: string
}

async function assertPublishedVersion(portal: TPortal, schemaId: string, version: number): Promise<void> {
  if (!Number.isInteger(version) || version < 0) {
    throw new RangeError("DbResource version must be a non-negative integer")
  }
  if (version === 0) return
  const migration = await fxDbResourceMigrationGet(portal, { schemaId, version })
  if (!migration || migration.status !== "published") {
    throw new Error(`DbResource schema "${schemaId}" has no published migration at version ${version}`)
  }
}

export async function txDbResourceSchemaCreate(portal: TPortal, args: TArgsSchemaCreate): Promise<TDbResourceSchema> {
  await (await portal.db.prepare(`
    INSERT INTO db_resource_schemas (id, name, description, status)
    VALUES (?, ?, ?, 'draft')
  `)).run(args.id, args.name, args.description ?? null)
  const schema = await fxDbResourceSchemaGet(portal, { id: args.id })
  if (!schema) throw new Error(`Failed to create DbResource schema "${args.id}"`)
  return schema
}

export async function txDbResourceSchemaUpdateDraft(
  portal: TPortal,
  args: TArgsSchemaUpdateDraft,
): Promise<TDbResourceSchema | null> {
  const result = await (await portal.db.prepare(`
    UPDATE db_resource_schemas
    SET name = ?, description = ?
    WHERE id = ? AND status = 'draft'
  `)).run(args.name, args.description ?? null, args.id)
  if (result.changes === 0) return null
  return fxDbResourceSchemaGet(portal, { id: args.id })
}

export async function txDbResourceSchemaDeleteDraft(portal: TPortal, args: TArgsSchemaId): Promise<boolean> {
  const result = await (await portal.db.prepare(`
    DELETE FROM db_resource_schemas
    WHERE id = ? AND status = 'draft'
  `)).run(args.id)
  return result.changes > 0
}

export async function txDbResourceSchemaPublish(portal: TPortal, args: TArgsSchemaId): Promise<TDbResourceSchema> {
  const schema = await fxDbResourceSchemaGet(portal, args)
  if (!schema || schema.status !== "draft") throw new Error(`DbResource schema "${args.id}" is not a draft`)
  const migrations = await fxDbResourceMigrationList(portal, { schemaId: args.id })
  fnDbResourceAssertContiguousMigrations(migrations)
  if (migrations.some((migration) => migration.status !== "draft")) {
    throw new Error("A draft DbResource schema cannot contain published migrations")
  }

  const publish = portal.db.transaction(async () => {
    await (await portal.db.prepare(`
      UPDATE db_resource_schema_migrations
      SET status = 'published', published_at = datetime('now')
      WHERE schema_id = ? AND status = 'draft'
    `)).run(args.id)
    const result = await (await portal.db.prepare(`
      UPDATE db_resource_schemas
      SET status = 'published'
      WHERE id = ? AND status = 'draft'
    `)).run(args.id)
    if (result.changes !== 1) throw new Error(`Failed to publish DbResource schema "${args.id}"`)
  })
  await publish()

  const published = await fxDbResourceSchemaGet(portal, args)
  if (!published) throw new Error(`Published DbResource schema "${args.id}" disappeared`)
  return published
}

export async function txDbResourceSchemaDeprecate(portal: TPortal, args: TArgsSchemaId): Promise<TDbResourceSchema | null> {
  const draftMigrations = await fxDbResourceMigrationList(portal, { schemaId: args.id, status: "draft" })
  if (draftMigrations.length > 0) throw new Error("Cannot deprecate a DbResource schema with a draft migration")
  const result = await (await portal.db.prepare(`
    UPDATE db_resource_schemas
    SET status = 'deprecated'
    WHERE id = ? AND status = 'published'
  `)).run(args.id)
  if (result.changes === 0) return null
  return fxDbResourceSchemaGet(portal, args)
}

export async function txDbResourceMigrationCreateDraft(
  portal: TPortal,
  args: TArgsMigrationCreateDraft,
): Promise<TDbResourceSchemaMigration> {
  const schema = await fxDbResourceSchemaGet(portal, { id: args.schemaId })
  if (!schema || schema.status === "deprecated") {
    throw new Error(`DbResource schema "${args.schemaId}" cannot accept migrations`)
  }
  const migrations = await fxDbResourceMigrationList(portal, { schemaId: args.schemaId })
  fnDbResourceAssertContiguousMigrations(migrations)
  const nextVersion = (migrations.at(-1)?.version ?? 0) + 1
  if (args.version !== nextVersion) {
    throw new Error(`Next DbResource migration for "${args.schemaId}" must be version ${nextVersion}`)
  }
  if (schema.status === "published" && migrations.some((migration) => migration.status === "draft")) {
    throw new Error("A published DbResource schema may have only one draft migration")
  }

  await (await portal.db.prepare(`
    INSERT INTO db_resource_schema_migrations (schema_id, version, name, sql, checksum, status)
    VALUES (?, ?, ?, ?, ?, 'draft')
  `)).run(args.schemaId, args.version, args.name, args.sql, args.checksum)
  const migration = await fxDbResourceMigrationGet(portal, args)
  if (!migration) throw new Error("Failed to create DbResource draft migration")
  return migration
}

export async function txDbResourceMigrationUpdateDraft(
  portal: TPortal,
  args: TArgsMigrationUpdateDraft,
): Promise<TDbResourceSchemaMigration | null> {
  const result = await (await portal.db.prepare(`
    UPDATE db_resource_schema_migrations
    SET name = ?, sql = ?, checksum = ?
    WHERE schema_id = ? AND version = ? AND status = 'draft'
  `)).run(args.name, args.sql, args.checksum, args.schemaId, args.version)
  if (result.changes === 0) return null
  return fxDbResourceMigrationGet(portal, args)
}

export async function txDbResourceMigrationDeleteDraft(portal: TPortal, args: TArgsMigrationIdentity): Promise<boolean> {
  const migrations = await fxDbResourceMigrationList(portal, { schemaId: args.schemaId })
  if (migrations.at(-1)?.version !== args.version) return false
  const result = await (await portal.db.prepare(`
    DELETE FROM db_resource_schema_migrations
    WHERE schema_id = ? AND version = ? AND status = 'draft'
  `)).run(args.schemaId, args.version)
  return result.changes > 0
}

export async function txDbResourceMigrationPublish(
  portal: TPortal,
  args: TArgsMigrationIdentity,
): Promise<TDbResourceSchemaMigration> {
  const schema = await fxDbResourceSchemaGet(portal, { id: args.schemaId })
  if (!schema || schema.status !== "published") {
    throw new Error(`DbResource schema "${args.schemaId}" must be published before publishing a migration`)
  }
  const migrations = await fxDbResourceMigrationList(portal, { schemaId: args.schemaId })
  fnDbResourceAssertContiguousMigrations(migrations)
  const migration = migrations.find((candidate) => candidate.version === args.version)
  if (!migration || migration.status !== "draft") throw new Error("DbResource migration is not a draft")
  const published = migrations.filter((candidate) => candidate.status === "published")
  const expectedVersion = (published.at(-1)?.version ?? 0) + 1
  if (args.version !== expectedVersion) {
    throw new Error(`Next published DbResource migration must be version ${expectedVersion}`)
  }

  const result = await (await portal.db.prepare(`
    UPDATE db_resource_schema_migrations
    SET status = 'published', published_at = datetime('now')
    WHERE schema_id = ? AND version = ? AND status = 'draft'
  `)).run(args.schemaId, args.version)
  if (result.changes !== 1) throw new Error("Failed to publish DbResource migration")
  const row = await fxDbResourceMigrationGet(portal, args)
  if (!row) throw new Error("Published DbResource migration disappeared")
  return row
}

export async function txDbResourceConfigurationCreate(
  portal: TPortal,
  args: TArgsConfigurationCreate,
): Promise<TDbResourceConfiguration> {
  const resource = await fxActorResourceGet(portal, { id: args.resourceId })
  if (!resource || resource.kind !== "db" || resource.status === "deleting") {
    throw new Error(`Actor resource "${args.resourceId}" is not an available DbResource`)
  }
  const schema = await fxDbResourceSchemaGet(portal, { id: args.schemaId })
  if (!schema || schema.status !== "published") {
    throw new Error(`DbResource schema "${args.schemaId}" is not published`)
  }
  const appliedVersion = args.appliedVersion ?? 0
  const targetVersion = args.targetVersion ?? appliedVersion
  fnDbResourceAssertVersions(appliedVersion, targetVersion)
  await assertPublishedVersion(portal, args.schemaId, appliedVersion)
  await assertPublishedVersion(portal, args.schemaId, targetVersion)

  await (await portal.db.prepare(`
    INSERT INTO db_resource_configurations (resource_id, schema_id, applied_version, target_version)
    VALUES (?, ?, ?, ?)
  `)).run(args.resourceId, args.schemaId, appliedVersion, targetVersion)
  const configuration = await fxDbResourceConfigurationGet(portal, args)
  if (!configuration) throw new Error("Failed to create DbResource configuration")
  return configuration
}

export async function txDbResourceConfigurationSetTargetVersion(
  portal: TPortal,
  args: TArgsConfigurationSetTargetVersion,
): Promise<TDbResourceConfiguration> {
  const configuration = await fxDbResourceConfigurationGet(portal, args)
  if (!configuration) throw new Error(`DbResource configuration "${args.resourceId}" was not found`)
  if (args.targetVersion < configuration.target_version) {
    throw new Error("DbResource target version cannot move backwards")
  }
  if (args.targetVersion === configuration.target_version) return configuration
  if (args.targetVersion <= configuration.applied_version) {
    throw new Error("DbResource migration target must be greater than its applied version")
  }
  await assertPublishedVersion(portal, configuration.schema_id, args.targetVersion)
  await (await portal.db.prepare(`
    UPDATE db_resource_configurations
    SET target_version = ?
    WHERE resource_id = ?
  `)).run(args.targetVersion, args.resourceId)
  const updated = await fxDbResourceConfigurationGet(portal, args)
  if (!updated) throw new Error("Updated DbResource configuration disappeared")
  return updated
}

export async function txDbResourceConfigurationSetVersions(
  portal: TPortal,
  args: TArgsConfigurationSetVersions,
): Promise<TDbResourceConfiguration> {
  const configuration = await fxDbResourceConfigurationGet(portal, args)
  if (!configuration) throw new Error(`DbResource configuration "${args.resourceId}" was not found`)
  fnDbResourceAssertVersions(args.appliedVersion, args.targetVersion)
  await assertPublishedVersion(portal, configuration.schema_id, args.appliedVersion)
  await assertPublishedVersion(portal, configuration.schema_id, args.targetVersion)
  await (await portal.db.prepare(`
    UPDATE db_resource_configurations
    SET applied_version = ?, target_version = ?
    WHERE resource_id = ?
  `)).run(args.appliedVersion, args.targetVersion, args.resourceId)
  const updated = await fxDbResourceConfigurationGet(portal, args)
  if (!updated) throw new Error("Updated DbResource configuration disappeared")
  return updated
}

export async function txDbResourceMigrationBlockUpsert(
  portal: TPortal,
  args: TArgsMigrationBlockUpsert,
): Promise<TDbResourceMigrationBlock> {
  await (await portal.db.prepare(`
    INSERT INTO db_resource_migration_blocks (
      resource_id,
      actor_instance_id,
      reason,
      restart_when_compatible,
      expected_schema_id,
      expected_version,
      actual_schema_id,
      actual_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (resource_id, actor_instance_id) DO UPDATE SET
      reason = excluded.reason,
      restart_when_compatible = excluded.restart_when_compatible,
      expected_schema_id = excluded.expected_schema_id,
      expected_version = excluded.expected_version,
      actual_schema_id = excluded.actual_schema_id,
      actual_version = excluded.actual_version
  `)).run(
    args.resourceId,
    args.actorInstanceId,
    args.reason,
    args.restartWhenCompatible,
    args.expectedSchemaId,
    args.expectedVersion,
    args.actualSchemaId,
    args.actualVersion,
  )
  const row = await (await portal.db.prepare(`
    SELECT *
    FROM db_resource_migration_blocks
    WHERE resource_id = ? AND actor_instance_id = ?
  `)).get(args.resourceId, args.actorInstanceId)
  if (!row) throw new Error("Failed to persist DbResource migration block")
  return fnParseDbResourceMigrationBlockRow(row)
}

export async function txDbResourceMigrationBlockRemove(portal: TPortal, args: TArgsMigrationBlockRemove): Promise<boolean> {
  const result = await (await portal.db.prepare(`
    DELETE FROM db_resource_migration_blocks
    WHERE resource_id = ? AND actor_instance_id = ?
  `)).run(args.resourceId, args.actorInstanceId)
  return result.changes > 0
}
