import {
  fnFreezeTenantContext,
  fnTenantContextMatchesPlacement,
} from '@omnidraw/tenant-core/fn.tenant-context';
import type { TTenantContext, TTenantContextRequest } from '@omnidraw/tenant-core';
import { OSS_FAKE_SESSION, OSS_TENANT_PLACEMENT } from './CONSTANTS';
import type { TOssFakeSession } from './types';

export function fnCreateOssTenantContext(request: TTenantContextRequest): TTenantContext {
  if (request.session !== OSS_FAKE_SESSION) {
    throw new Error('Unauthenticated tenant session.');
  }
  const session = request.session as TOssFakeSession;
  return fnFreezeTenantContext({
    orgId: session.orgId,
    accountId: session.accountId,
    cellId: session.cellId,
    placementEpoch: session.placementEpoch,
    roles: session.roles,
    capabilities: session.capabilities,
    requestId: request.requestId,
    ...(request.canvasId === undefined ? {} : { canvasId: request.canvasId }),
    ...(request.invocationId === undefined ? {} : { invocationId: request.invocationId }),
  });
}

export function fnAssertOssTenantPlacement(context: TTenantContext): TTenantContext {
  if (!fnTenantContextMatchesPlacement(context, OSS_TENANT_PLACEMENT)) {
    throw new Error('Stale tenant placement.');
  }
  return context;
}
