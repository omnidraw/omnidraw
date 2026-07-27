import type { TWidgetStateInstanceIdentity } from '@vibecanvas/service-widget-state';
import type { TTenantContext } from '@vibecanvas/tenant-core';

type TWidgetStateIdentityInput = Readonly<{
  canvasId: string;
  elementId: string;
  widgetInstanceId: string;
  definitionId: string;
  revisionId: string;
}>;

function widgetStateIdentity(
  tenant: TTenantContext,
  input: TWidgetStateIdentityInput,
): TWidgetStateInstanceIdentity {
  return Object.freeze({
    orgId: tenant.orgId,
    canvasId: input.canvasId,
    elementId: input.elementId,
    widgetInstanceId: input.widgetInstanceId,
    definitionId: input.definitionId,
    revisionId: input.revisionId,
  });
}

export { widgetStateIdentity };
