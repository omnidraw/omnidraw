import type {
  TPortalGeometry,
} from '@omnidraw/cangine';
import type {
  CapsuleViewport,
} from '@omnidraw/capsule-omnidraw/host';
import {
  fnWidgetCapsuleViewport,
} from '../widget-runtime/fn.capsule-viewport';
import {
  fxPortalContentCssSize,
  type TPortal as TPortalContentCssSize,
} from '../widget-runtime/fx.portal-content-css-size';

export type TPortal = TPortalContentCssSize;

export type TArgs = Readonly<{
  host: HTMLElement | null;
  geometry: Readonly<TPortalGeometry> | null;
  visible: boolean;
}>;

export function fxWidgetCapsuleViewport(
  portal: TPortal,
  args: TArgs,
): CapsuleViewport {
  const size = args.host === null
    ? { width: 0, height: 0 }
    : fxPortalContentCssSize(portal, { host: args.host });
  return fnWidgetCapsuleViewport({
    width: size.width,
    height: size.height,
    scale: args.geometry?.devicePixelRatio ?? 1,
    visibility: args.visible ? 'visible' : 'hidden',
    distance: 0,
    priority: args.visible ? 100 : 0,
    occlusion: 0,
  });
}
