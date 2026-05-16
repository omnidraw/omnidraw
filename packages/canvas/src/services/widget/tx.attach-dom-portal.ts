import type { TElement, TUiWidgetData, TWidgetData } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import type { CameraService, SelectionService, WidgetManagerService } from '..';
import { ELEMENT_DATA_ATTR } from '../../core/CONSTANTS';
import { isKonvaGroup, isKonvaRect } from '../../core/GUARDS';
import {
  WIDGET_DOM_PORTAL_FULLSCREEN_Z_INDEX,
  WIDGET_HOST_BODY_ID,
  WIDGET_HOST_BORDER_ID,
  WIDGET_HOST_HEADER_HEIGHT,
  WIDGET_WINDOW_CONTAINED,
  WIDGET_WINDOW_FULLSCREEN,
} from './CONSTANTS';
import type { IWidgetConfig, TWidgetRenderCleanup } from './interface';
import { txMountArrowSandbox } from './tx.mount-arrow-sandbox';

type TPortal = {
  node: unknown;
  document: typeof document;
  widgetServie: WidgetManagerService;
  widgetPortal: HTMLDivElement;
  cameraService: CameraService;
  selectionService?: SelectionService;
  widgetConfig?: IWidgetConfig;
};

type TArgs = {
  element: TElement;
};

export type TWidgetDomPortalListener = (() => void) & {
  syncDiv: () => void;
};

/**
 * For a given widget node. It will attach a dom div to render the widget content.
 */
export function txAttachDomPortal(portal: TPortal, args: TArgs) {
  if (!isKonvaGroup(portal.node)) return;

  const body = portal.node.findOne(`#${WIDGET_HOST_BODY_ID}`);
  if (!isKonvaRect(body)) return;

  const div = portal.document.createElement('div');
  const fullscreenHeader = portal.document.createElement('div');
  const fullscreenWindowButton = portal.document.createElement('button');
  const view = portal.document.defaultView;

  let disposed = false;
  let initialRenderTimer: number | null = null;
  let cleanupRender: TWidgetRenderCleanup | void;

  const syncDiv = () => {
    if (disposed || !div.isConnected) return;
    if (!isKonvaGroup(portal.node)) return

    const matrix = body.getAbsoluteTransform().getMatrix();
    const widgetData = portal.node.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData | TWidgetData | undefined;
    const isWidgetHost = widgetData?.type === 'widget' || widgetData?.type === 'ui-widget';
    const isCollapsed = isWidgetHost && widgetData.expanded === false;
    const isFullscreen = isWidgetHost && widgetData.window === WIDGET_WINDOW_FULLSCREEN;
    const isActive = portal.selectionService?.focusedId === args.element.id;

    div.style.display = isCollapsed ? 'none' : '';
    div.style.pointerEvents = isActive ? 'auto' : 'none';
    div.style.boxShadow = isActive
      ? '0 0 0 2px #38bdf8, 0 0 24px rgba(56, 189, 248, 0.45)'
      : '';

    const border = portal.node.findOne(`#${WIDGET_HOST_BORDER_ID}`);
    if (isKonvaRect(border)) {
      border.shadowEnabled(isActive);
      border.shadowColor('#38bdf8');
      border.shadowBlur(isActive ? 18 : 0);
      border.shadowOpacity(isActive ? 0.65 : 0);
      border.shadowForStrokeEnabled(true);
      border.getLayer()?.batchDraw();
    }

    if (isFullscreen) {
      const fullscreenParent = portal.widgetPortal.parentElement ?? portal.widgetPortal;
      portal.widgetPortal.style.zIndex = WIDGET_DOM_PORTAL_FULLSCREEN_Z_INDEX;
      fullscreenHeader.style.display = '';
      fullscreenHeader.style.width = `${fullscreenParent.clientWidth}px`;
      fullscreenHeader.style.height = `${WIDGET_HOST_HEADER_HEIGHT}px`;
      fullscreenHeader.style.zIndex = WIDGET_DOM_PORTAL_FULLSCREEN_Z_INDEX;
      div.style.top = `${WIDGET_HOST_HEADER_HEIGHT}px`;
      div.style.width = `${fullscreenParent.clientWidth}px`;
      div.style.height = `${Math.max(0, fullscreenParent.clientHeight - WIDGET_HOST_HEADER_HEIGHT)}px`;
      div.style.transform = 'none';
      div.style.zIndex = WIDGET_DOM_PORTAL_FULLSCREEN_Z_INDEX;
      return;
    }

    portal.widgetPortal.style.zIndex = '';
    fullscreenHeader.style.display = 'none';
    fullscreenHeader.style.zIndex = '';
    div.style.top = '0';
    div.style.zIndex = '';
    div.style.width = `${body.width()}px`;
    div.style.height = `${body.height()}px`;
    div.style.transform = `matrix(${matrix.join(',')})`;
  };

  const removeCameraListener = portal.cameraService.hooks.change.tap(syncDiv);
  const removeSelectionListener = portal.selectionService?.hooks.change.tap(syncDiv) ?? (() => undefined);
  const stopActiveDomEvent = (event: Event) => {
    if (div.style.pointerEvents !== 'auto') return;
    event.stopPropagation();
  };
  const domEventTypes = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'dblclick', 'wheel', 'keydown', 'keyup'];
  domEventTypes.forEach((eventType) => div.addEventListener(eventType, stopActiveDomEvent));

  portal.node.on('dragmove', syncDiv);

  const removeListener = (() => {
    if (!isKonvaGroup(portal.node)) return;
    if (disposed) return;

    disposed = true;
    removeCameraListener();
    removeSelectionListener();
    if (view && initialRenderTimer !== null) {
      view.clearTimeout(initialRenderTimer);
    }
    portal.node.off('dragmove', syncDiv);
    portal.node.off('destroy', onNodeDestroy);
    domEventTypes.forEach((eventType) => div.removeEventListener(eventType, stopActiveDomEvent));
    cleanupRender?.();
    cleanupRender = undefined;
    fullscreenHeader.remove();
    div.remove();
  }) as TWidgetDomPortalListener;
  removeListener.syncDiv = syncDiv;
  const onNodeDestroy = () => removeListener();
  portal.node.on('destroy', onNodeDestroy);

  fullscreenHeader.dataset.widgetFullscreenHeaderId = args.element.id;
  fullscreenHeader.style.position = 'absolute';
  fullscreenHeader.style.left = '0';
  fullscreenHeader.style.top = '0';
  fullscreenHeader.style.display = 'none';
  fullscreenHeader.style.alignItems = 'center';
  fullscreenHeader.style.justifyContent = 'flex-end';
  fullscreenHeader.style.boxSizing = 'border-box';
  fullscreenHeader.style.padding = '0 10px';
  fullscreenHeader.style.backgroundColor = '#111827';
  fullscreenHeader.style.borderBottom = '1px solid #374151';
  fullscreenHeader.style.pointerEvents = 'auto';

  const windowIcon = portal.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  windowIcon.setAttribute('viewBox', '0 0 24 24');
  windowIcon.setAttribute('width', '16');
  windowIcon.setAttribute('height', '16');
  windowIcon.setAttribute('aria-hidden', 'true');
  windowIcon.innerHTML = '<path d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7Zm2 0v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9H6V7Zm11-1H7a1 1 0 0 0-1 1v1h12V7a1 1 0 0 0-1-1Z" fill="currentColor" />';

  fullscreenWindowButton.dataset.widgetFullscreenWindowButtonId = args.element.id;
  fullscreenWindowButton.type = 'button';
  const windowButtonLabel = portal.document.createElement('span');
  windowButtonLabel.textContent = 'Exit Fullscreen';

  fullscreenWindowButton.title = 'Exit Fullscreen';
  fullscreenWindowButton.setAttribute('aria-label', 'Exit Fullscreen');
  fullscreenWindowButton.style.display = 'inline-flex';
  fullscreenWindowButton.style.alignItems = 'center';
  fullscreenWindowButton.style.justifyContent = 'center';
  fullscreenWindowButton.style.gap = '6px';
  fullscreenWindowButton.style.height = '24px';
  fullscreenWindowButton.style.border = '1px solid #4b5563';
  fullscreenWindowButton.style.borderRadius = '6px';
  fullscreenWindowButton.style.backgroundColor = '#1f2937';
  fullscreenWindowButton.style.color = '#f9fafb';
  fullscreenWindowButton.style.cursor = 'pointer';
  fullscreenWindowButton.style.fontSize = '12px';
  fullscreenWindowButton.style.fontWeight = '600';
  fullscreenWindowButton.style.lineHeight = '1';
  fullscreenWindowButton.style.padding = '0 8px';
  fullscreenWindowButton.appendChild(windowIcon);
  fullscreenWindowButton.appendChild(windowButtonLabel);
  fullscreenWindowButton.onclick = () => {
    if (!isKonvaGroup(portal.node)) return;

    const widgetData = portal.node.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData | TWidgetData | undefined;
    if (widgetData?.type === 'widget' || widgetData?.type === 'ui-widget') {
      portal.node.setAttr(ELEMENT_DATA_ATTR, {
        ...widgetData,
        window: WIDGET_WINDOW_CONTAINED,
      });
    }
    syncDiv();
  };
  fullscreenHeader.appendChild(fullscreenWindowButton);

  div.dataset.widgetElementId = args.element.id;
  div.dataset.hostedWidgetRoot = 'true';
  div.style.position = 'absolute';
  div.style.left = '0';
  div.style.top = '0';
  div.style.transformOrigin = '0 0';
  div.style.backgroundColor = 'white';
  div.style.pointerEvents = 'none';
  div.style.overflow = 'hidden';
  div.style.contain = 'layout paint size';

  portal.widgetPortal.appendChild(fullscreenHeader);
  portal.widgetPortal.appendChild(div);
  cleanupRender = portal.widgetConfig?.renderDom?.({ root: div, element: args.element });

  if (portal.widgetConfig?.sandbox) {
    txMountArrowSandbox({ root: div }, { sandbox: portal.widgetConfig.sandbox });
  }

  if (view) {
    initialRenderTimer = view.setTimeout(syncDiv, 0);
  } else {
    syncDiv();
  }

  return removeListener;
}
