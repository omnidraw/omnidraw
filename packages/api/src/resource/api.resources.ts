import { ORPCError } from '@orpc/contract';
import { fnResourceSecretRevealAllowed } from '@vibecanvas/resource-runtime';
import { withResourceApiError } from './api.resource-error';
import { baseResourceOs } from './orpc';

export const apiListResources = baseResourceOs.resources.list.handler(async ({ input, context }) => {
  return withResourceApiError(() => context.resource.listResources(context.tenant, input ?? {}));
});

export const apiGetResource = baseResourceOs.resources.get.handler(async ({ input, context }) => {
  const resource = await withResourceApiError(() => context.resource.getResource(context.tenant, input.resourceId));
  if (!resource) throw new ORPCError('NOT_FOUND');
  return resource;
});

export const apiCreateResource = baseResourceOs.resources.create.handler(async ({ input, context }) => {
  return withResourceApiError(() => context.resource.createResource(context.tenant, input));
});

export const apiRenameResource = baseResourceOs.resources.rename.handler(async ({ input, context }) => {
  return withResourceApiError(() => context.resource.renameResource(
    context.tenant,
    { id: input.resourceId, name: input.name },
  ));
});

export const apiDeleteResource = baseResourceOs.resources.delete.handler(async ({ input, context }) => {
  await withResourceApiError(() => context.resource.deleteResource(context.tenant, input.resourceId));
  return { deleted: true };
});

export const apiListResourceReferences = baseResourceOs.resources.references.handler(async ({ input, context }) => {
  return withResourceApiError(() => context.resource.listResourceReferences(context.tenant, input.resourceId));
});

export const apiListResourceData = baseResourceOs.resources.data.handler(async ({ input, context }) => {
  return withResourceApiError(() => context.resource.listResourceData(context.tenant, input));
});

export const apiSetResourceData = baseResourceOs.resources.dataSet.handler(async ({ input, context }) => {
  return withResourceApiError(() => context.resource.setResourceDataEntry(context.tenant, input));
});

export const apiDeleteResourceData = baseResourceOs.resources.dataDelete.handler(async ({ input, context }) => {
  return withResourceApiError(() => context.resource.deleteResourceDataEntry(context.tenant, input));
});

export const apiRevealResourceSecret = baseResourceOs.resources.dataRevealSecret.handler(async ({ input, context }) => {
  if (!fnResourceSecretRevealAllowed(context.tenant)) {
    throw new ORPCError('FORBIDDEN', { message: 'Secret reveal requires an authorized human session.' });
  }
  const reveal = await withResourceApiError(() => context.humanResourceSecret.revealSecret(context.tenant, input));
  if (!reveal) throw new ORPCError('NOT_FOUND');
  return reveal;
});

export const apiDefinitionResourceStatus = baseResourceOs.resources.definitionStatus.handler(async ({ input, context }) => {
  return withResourceApiError(() => context.resource.getDefinitionResourceStatus(context.tenant, input.definitionName));
});

export const apiBindResource = baseResourceOs.resources.bind.handler(async ({ input, context }) => {
  return withResourceApiError(() => context.resource.bindResource(context.tenant, input));
});

export const apiUnbindResource = baseResourceOs.resources.unbind.handler(async ({ input, context }) => {
  const deleted = await withResourceApiError(() => context.resource.unbindResource(context.tenant, input));
  return { deleted };
});

export const apiListActorResources = apiListResources;
export const apiGetActorResource = apiGetResource;
export const apiCreateActorResource = apiCreateResource;
export const apiRenameActorResource = apiRenameResource;
export const apiDeleteActorResource = apiDeleteResource;
export const apiListActorResourceReferences = apiListResourceReferences;
export const apiListActorResourceData = apiListResourceData;
export const apiSetActorResourceData = apiSetResourceData;
export const apiDeleteActorResourceData = apiDeleteResourceData;
export const apiRevealActorResourceSecret = apiRevealResourceSecret;
export const apiActorDefinitionResourceStatus = apiDefinitionResourceStatus;
export const apiBindActorResource = apiBindResource;
export const apiUnbindActorResource = apiUnbindResource;
