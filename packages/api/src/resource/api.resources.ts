import { ORPCError } from '@orpc/contract';
import { withResourceApiError } from './api.resource-error';
import { baseResourceOs } from './orpc';

export const apiListResources = baseResourceOs.resources.list.handler(async ({ input, context }) => {
  return withResourceApiError(() => context.resource.listResources(input ?? {}));
});

export const apiGetResource = baseResourceOs.resources.get.handler(async ({ input, context }) => {
  const resource = await withResourceApiError(() => context.resource.getResource(input.resourceId));
  if (!resource) throw new ORPCError('NOT_FOUND');
  return resource;
});

export const apiCreateResource = baseResourceOs.resources.create.handler(async ({ input, context }) => {
  return withResourceApiError(() => context.resource.createResource(input));
});

export const apiRenameResource = baseResourceOs.resources.rename.handler(async ({ input, context }) => {
  return withResourceApiError(() => context.resource.renameResource(
    { id: input.resourceId, name: input.name },
  ));
});

export const apiDeleteResource = baseResourceOs.resources.delete.handler(async ({ input, context }) => {
  await withResourceApiError(() => context.resource.deleteResource(input.resourceId));
  return { deleted: true };
});

export const apiListResourceData = baseResourceOs.resources.data.handler(async ({ input, context }) => {
  return withResourceApiError(() => context.resource.listResourceData(input));
});

export const apiSetResourceData = baseResourceOs.resources.dataSet.handler(async ({ input, context }) => {
  return withResourceApiError(() => context.resource.setResourceDataEntry(input));
});

export const apiDeleteResourceData = baseResourceOs.resources.dataDelete.handler(async ({ input, context }) => {
  return withResourceApiError(() => context.resource.deleteResourceDataEntry(input));
});

export const apiRevealResourceSecret = baseResourceOs.resources.dataRevealSecret.handler(async ({ input, context }) => {
  // Plaintext reveal exists only on this trusted local human API surface; the
  // runtime gateway and management capabilities expose no secret reads.
  const reveal = await withResourceApiError(() => context.humanResourceSecret.revealSecret(input));
  if (!reveal) throw new ORPCError('NOT_FOUND');
  return reveal;
});
