import { TElement } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import { isKonvaGroup, isKonvaRect } from '../../core/GUARDS';
import { WIDGET_HOST_BODY_ID } from './CONSTANTS';
import { CameraService, SceneService, WidgetManagerService } from '..';

type TPortal = {
  node: unknown
  document: typeof document;
  widgetServie: WidgetManagerService;
  widgetPortal: HTMLDivElement;
  cameraService: CameraService;
}

type TArgs = {
  element: TElement;
}


/**
 * For a given widget node. It will attach a dom div to render the widget content
 */
export function txAttachDomPortal(portal: TPortal, args: TArgs) {
  if (!isKonvaGroup(portal.node)) return;
  const body = portal.node.findOne(`#${WIDGET_HOST_BODY_ID}`)
  if (!isKonvaRect(body)) return;
  const div = portal.document.createElement('div');
  const canvasX = body.x();
  const canvasY = body.y();
  div.style.position = 'absolute';
  div.style.left = '0px';
  div.style.top = '0px';
  div.style.width = `${body.width()}px`;
  div.style.height = `${body.height()}px`;
  div.style.backgroundColor = 'red';
  div.style.transformOrigin = "0 0";
  div.style.transform = `translate(${canvasX}px, ${canvasY}px) scale(${portal.cameraService.zoom})`;
  portal.cameraService.hooks.change.tap(() => {
    const canvasX = body.x();
    const canvasY = body.y();
    div.style.transform = `translate(${canvasX}px, ${canvasY}px) scale(${portal.cameraService.zoom})`;
  })
  portal.widgetPortal.appendChild(div);


}
