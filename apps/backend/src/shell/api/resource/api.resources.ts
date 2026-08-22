import { ResourceError } from '#backend/core/resources/ResourceError';
import { ProcedureError } from '../procedure';
import { withResourceApiError } from './api.resource-error';
import { baseResourceOs } from './procedure-builder';
import type { TResourceApiCapability } from './types';

function disabledSecretStore(): ResourceError {
  return new ResourceError('RESOURCE_KIND_DISABLED', 'Secret Store resources are disabled.');
}

async function assertResourceEnabled(resource: TResourceApiCapability, resourceId: string): Promise<void> {
  const current = await resource.getResource(resourceId);
  if (current?.kind === 'secretStore') throw disabledSecretStore();
}

export const apiListResources = baseResourceOs.resources.list.handler(async ({ input, context }) => {
  return withResourceApiError(async () => {
    if (input?.kind === 'secretStore') return [];
    const resources = await context.resource.listResources(input ?? {});
    return resources.filter((resource) => resource.kind !== 'secretStore');
  });
});

export const apiGetResource = baseResourceOs.resources.get.handler(async ({ input, context }) => {
  const resource = await withResourceApiError(() => context.resource.getResource(input.resourceId));
  if (!resource) throw new ProcedureError('NOT_FOUND');
  if (resource.kind === 'secretStore') {
    return withResourceApiError(() => Promise.reject(disabledSecretStore()));
  }
  return resource;
});

export const apiCreateResource = baseResourceOs.resources.create.handler(async ({ input, context }) => {
  return withResourceApiError(() => {
    if (input.kind === 'secretStore') throw disabledSecretStore();
    return context.resource.createResource(input);
  });
});

export const apiRenameResource = baseResourceOs.resources.rename.handler(async ({ input, context }) => {
  return withResourceApiError(async () => {
    await assertResourceEnabled(context.resource, input.resourceId);
    return context.resource.renameResource({ id: input.resourceId, name: input.name });
  });
});

export const apiDeleteResource = baseResourceOs.resources.delete.handler(async ({ input, context }) => {
  await withResourceApiError(async () => {
    await assertResourceEnabled(context.resource, input.resourceId);
    return context.resource.deleteResource(input.resourceId);
  });
  return { deleted: true };
});

export const apiListResourceData = baseResourceOs.resources.data.handler(async ({ input, context }) => {
  return withResourceApiError(async () => {
    await assertResourceEnabled(context.resource, input.resourceId);
    return context.resource.listResourceData(input);
  });
});

export const apiSetResourceData = baseResourceOs.resources.dataSet.handler(async ({ input, context }) => {
  return withResourceApiError(async () => {
    await assertResourceEnabled(context.resource, input.resourceId);
    return context.resource.setResourceDataEntry(input);
  });
});

export const apiDeleteResourceData = baseResourceOs.resources.dataDelete.handler(async ({ input, context }) => {
  return withResourceApiError(async () => {
    await assertResourceEnabled(context.resource, input.resourceId);
    return context.resource.deleteResourceDataEntry(input);
  });
});

export const apiRevealResourceSecret = baseResourceOs.resources.dataRevealSecret.handler(async () => {
  return withResourceApiError(() => Promise.reject(disabledSecretStore()));
});
