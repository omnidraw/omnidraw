import type {
  TWidgetCapsuleNotificationOutput,
} from '@vibecanvas/widget-contract';

type TPortal = Readonly<{
  showError(title: string, description?: string): unknown;
  showInfo(title: string, description?: string): unknown;
  showSuccess(title: string, description?: string): unknown;
}>;

type TArgs = Readonly<{
  output: TWidgetCapsuleNotificationOutput;
}>;

/** Maps the sole guest output action to a fixed-title application toast. */
export function txRouteWidgetCapsuleOutput(
  portal: TPortal,
  args: TArgs,
): void {
  if (args.output.tone === 'error') {
    portal.showError('Widget', args.output.message);
    return;
  }
  if (args.output.tone === 'success') {
    portal.showSuccess('Widget', args.output.message);
    return;
  }
  portal.showInfo('Widget', args.output.message);
}
