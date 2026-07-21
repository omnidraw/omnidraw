import { ORPCError } from '@orpc/contract';
import { baseActorsOs } from '../actor/orpc';
import { withActorResourceApiError } from './api.resource-error';

export const apiListActorResources = baseActorsOs.resources.list.handler(async ({ input, context }) => {
  return withActorResourceApiError(() => context.actor.listResources(input ?? {}));
});

export const apiGetActorResource = baseActorsOs.resources.get.handler(async ({ input, context }) => {
  const resource = await withActorResourceApiError(() => context.actor.getResource(input.resourceId));
  if (!resource) throw new ORPCError('NOT_FOUND');
  return resource;
});

export const apiCreateActorResource = baseActorsOs.resources.create.handler(async ({ input, context }) => {
  return withActorResourceApiError(() => context.actor.createResource(input));
});

export const apiRenameActorResource = baseActorsOs.resources.rename.handler(async ({ input, context }) => {
  return withActorResourceApiError(() => context.actor.renameResource({ id: input.resourceId, name: input.name }));
});

export const apiDeleteActorResource = baseActorsOs.resources.delete.handler(async ({ input, context }) => {
  await withActorResourceApiError(() => context.actor.deleteResource(input.resourceId));
  return { deleted: true };
});

export const apiListActorResourceReferences = baseActorsOs.resources.references.handler(async ({ input, context }) => {
  return withActorResourceApiError(() => context.actor.listResourceReferences(input.resourceId));
});

export const apiListActorResourceData = baseActorsOs.resources.data.handler(async ({ input, context }) => {
  return withActorResourceApiError(() => context.actor.listResourceData(input));
});

export const apiSetActorResourceData = baseActorsOs.resources.dataSet.handler(async ({ input, context }) => {
  return withActorResourceApiError(() => context.actor.setResourceDataEntry(input));
});

export const apiDeleteActorResourceData = baseActorsOs.resources.dataDelete.handler(async ({ input, context }) => {
  return withActorResourceApiError(() => context.actor.deleteResourceDataEntry(input));
});

export const apiRevealActorResourceSecret = baseActorsOs.resources.dataRevealSecret.handler(async ({ input, context }) => {
  return withActorResourceApiError(() => context.actor.revealResourceSecret(input));
});

export const apiActorDefinitionResourceStatus = baseActorsOs.resources.definitionStatus.handler(async ({ input, context }) => {
  return withActorResourceApiError(() => context.actor.getDefinitionResourceStatus(input.definitionName));
});

export const apiBindActorResource = baseActorsOs.resources.bind.handler(async ({ input, context }) => {
  return withActorResourceApiError(() => context.actor.bindResource(input));
});

export const apiUnbindActorResource = baseActorsOs.resources.unbind.handler(async ({ input, context }) => {
  const deleted = await withActorResourceApiError(() => context.actor.unbindResource(input));
  return { deleted };
});
