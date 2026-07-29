import type {
  TWidgetDropdownItemPresentation,
} from '@omnidraw/cangine/editor';

export type TArgs = Readonly<{
  liveUpdatesPaused: boolean;
  pendingBuild: boolean;
  publishable: boolean;
}>;

export function fnPreviewControlPresentation(
  args: TArgs,
): Readonly<Record<string, TWidgetDropdownItemPresentation>> {
  return Object.freeze({
    'live-updates': Object.freeze({
      text: args.liveUpdatesPaused
        ? 'Resume live updates'
        : 'Pause live updates',
    }),
    'cancel-build': Object.freeze({
      disabled: !args.pendingBuild,
    }),
    retry: Object.freeze({}),
    reset: Object.freeze({}),
    publish: Object.freeze({
      disabled: !args.publishable,
    }),
  });
}
