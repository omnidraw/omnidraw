import type { CapsuleViewport } from '@vibecanvas/capsule-vibecanvas/host';
import {
  fnWidgetCapsuleViewport,
} from '../widget-runtime/fn.capsule-viewport';

type TArgs = Readonly<{
  viewport: CapsuleViewport;
  contentSize: Readonly<{
    width: number;
    height: number;
  }>;
}>;

function fnContentDimension(measured: number, fallback: number): number {
  return Number.isFinite(measured) && (measured > 0 || fallback === 0)
    ? measured
    : fallback;
}

export function fnPreviewGuestViewport(args: TArgs): CapsuleViewport {
  return fnWidgetCapsuleViewport({
    ...args.viewport,
    width: fnContentDimension(
      args.contentSize.width,
      args.viewport.width,
    ),
    height: fnContentDimension(
      args.contentSize.height,
      args.viewport.height,
    ),
  });
}
