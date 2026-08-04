import type { TWidgetStateInstanceIdentity } from '@omnidraw/service-widget-state';

type TWidgetStateIdentityInput = Readonly<{
  canvasId: string;
  elementId: string;
  widgetInstanceId: string;
}>;

function widgetStateIdentity(
  input: TWidgetStateIdentityInput,
): TWidgetStateInstanceIdentity {
  return Object.freeze({
    canvasId: input.canvasId,
    elementId: input.elementId,
    widgetInstanceId: input.widgetInstanceId,
  });
}

export { widgetStateIdentity };
