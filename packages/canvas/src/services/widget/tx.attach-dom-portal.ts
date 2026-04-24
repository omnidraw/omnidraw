import type { TElement } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import { isKonvaGroup, isKonvaRect } from '../../core/GUARDS';
import { WIDGET_HOST_BODY_ID } from './CONSTANTS';
import type { CameraService, WidgetManagerService } from '..';

type TPortal = {
  node: unknown;
  document: typeof document;
  widgetServie: WidgetManagerService;
  widgetPortal: HTMLDivElement;
  cameraService: CameraService;
};

type TArgs = {
  element: TElement;
};

/**
 * For a given widget node. It will attach a dom div to render the widget content.
 */
export function txAttachDomPortal(portal: TPortal, args: TArgs) {
  if (!isKonvaGroup(portal.node)) return;

  const body = portal.node.findOne(`#${WIDGET_HOST_BODY_ID}`);
  if (!isKonvaRect(body)) return;

  const div = portal.document.createElement('div');
  const view = portal.document.defaultView;

  let disposed = false;
  let initialRenderTimer: number | null = null;

  const syncDiv = () => {
    if (disposed || !div.isConnected) return;

    const matrix = body.getAbsoluteTransform().getMatrix();

    div.style.width = `${body.width()}px`;
    div.style.height = `${body.height()}px`;
    div.style.transform = `matrix(${matrix.join(',')})`;
  };

  const removeCameraListener = portal.cameraService.hooks.change.tap(syncDiv);

  const removeListener = () => {
    disposed = true;
    removeCameraListener();
    if (view && initialRenderTimer !== null) {
      view.clearTimeout(initialRenderTimer);
    }
    div.remove();
  };

  div.dataset.widgetElementId = args.element.id;
  div.style.position = 'absolute';
  div.style.left = '0';
  div.style.top = '0';
  div.style.transformOrigin = '0 0';
  div.style.backgroundColor = 'red';
  div.style.pointerEvents = 'auto';

  portal.widgetPortal.appendChild(div);
  if (view) {
    initialRenderTimer = view.setTimeout(syncDiv, 0);
  } else {
    syncDiv();
  }

  return removeListener;
}
