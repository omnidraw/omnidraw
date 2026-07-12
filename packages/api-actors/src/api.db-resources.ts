import { ORPCError } from '@orpc/contract';
import { baseActorsOs } from './orpc';
import { withActorResourceApiError } from './api.resource-error';

export const apiListDbSchemas = baseActorsOs.dbSchemas.list.handler(async ({ input, context }) => {
  return withActorResourceApiError(() => context.actor.listDbSchemas(input ?? {}));
});

export const apiGetDbSchema = baseActorsOs.dbSchemas.get.handler(async ({ input, context }) => {
  const schema = await withActorResourceApiError(() => context.actor.getDbSchema(input.id));
  if (!schema) throw new ORPCError('NOT_FOUND');
  return schema;
});

export const apiCreateDbSchema = baseActorsOs.dbSchemas.create.handler(async ({ input, context }) => {
  return withActorResourceApiError(() => context.actor.createDbSchema(input));
});

export const apiUpdateDbSchemaDraft = baseActorsOs.dbSchemas.updateDraft.handler(async ({ input, context }) => {
  const schema = await withActorResourceApiError(() => context.actor.updateDbSchemaDraft(input));
  if (!schema) throw new ORPCError('NOT_FOUND');
  return schema;
});

export const apiDeleteDbSchemaDraft = baseActorsOs.dbSchemas.deleteDraft.handler(async ({ input, context }) => {
  return { deleted: await withActorResourceApiError(() => context.actor.deleteDbSchemaDraft(input.id)) };
});

export const apiPublishDbSchema = baseActorsOs.dbSchemas.publish.handler(async ({ input, context }) => {
  return withActorResourceApiError(() => context.actor.publishDbSchema(input.id));
});

export const apiDeprecateDbSchema = baseActorsOs.dbSchemas.deprecate.handler(async ({ input, context }) => {
  const schema = await withActorResourceApiError(() => context.actor.deprecateDbSchema(input.id));
  if (!schema) throw new ORPCError('NOT_FOUND');
  return schema;
});

export const apiListDbMigrations = baseActorsOs.dbMigrations.list.handler(async ({ input, context }) => {
  return withActorResourceApiError(() => context.actor.listDbMigrations(input));
});

export const apiCreateDbMigrationDraft = baseActorsOs.dbMigrations.createDraft.handler(async ({ input, context }) => {
  return withActorResourceApiError(() => context.actor.createDbMigrationDraft(input));
});

export const apiUpdateDbMigrationDraft = baseActorsOs.dbMigrations.updateDraft.handler(async ({ input, context }) => {
  const migration = await withActorResourceApiError(() => context.actor.updateDbMigrationDraft(input));
  if (!migration) throw new ORPCError('NOT_FOUND');
  return migration;
});

export const apiDeleteDbMigrationDraft = baseActorsOs.dbMigrations.deleteDraft.handler(async ({ input, context }) => {
  return { deleted: await withActorResourceApiError(() => context.actor.deleteDbMigrationDraft(input)) };
});

export const apiPublishDbMigration = baseActorsOs.dbMigrations.publish.handler(async ({ input, context }) => {
  return withActorResourceApiError(() => context.actor.publishDbMigration(input));
});

export const apiGetDbResourceConfiguration = baseActorsOs.dbResources.configuration.handler(async ({ input, context }) => {
  const configuration = await withActorResourceApiError(() => context.actor.getDbResourceConfiguration(input.resourceId));
  if (!configuration) throw new ORPCError('NOT_FOUND');
  return configuration;
});

export const apiPreviewDbResourceMigration = baseActorsOs.dbResources.previewMigration.handler(async ({ input, context }) => {
  return withActorResourceApiError(() => context.actor.previewDbResourceMigration(input.resourceId, input.targetVersion));
});

export const apiMigrateDbResource = baseActorsOs.dbResources.migrate.handler(async ({ input, context }) => {
  return withActorResourceApiError(() => context.actor.migrateDbResource(input.resourceId, input.targetVersion));
});
