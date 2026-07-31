import type {
  TPortalGeometry,
} from '@omnidraw/cangine';
import type {
  CapsuleViewport,
} from '@omnidraw/capsule-omnidraw/host';

export type TPortal = Readonly<{
  readPortalContentCssSize(
    host: HTMLElement,
  ): Readonly<{ width: number; height: number }>;
  portalGeometryToCapsuleViewport(
    input: Readonly<{
      contentWidth: number;
      contentHeight: number;
      geometry: Readonly<TPortalGeometry> | null;
      visible: boolean;
      distance?: number;
      priority?: number;
      occlusion?: number;
    }>,
  ): CapsuleViewport;
}>;

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
    : portal.readPortalContentCssSize(args.host);
  return portal.portalGeometryToCapsuleViewport({
    contentWidth: size.width,
    contentHeight: size.height,
    geometry: args.geometry,
    visible: args.visible,
    distance: 0,
    priority: args.visible ? 100 : 0,
    occlusion: 0,
  });
}
