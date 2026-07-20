// NOTE: do not rename to tx.* this file is exception to rule because of './mount-arrow-sandbox' import
import type { TElement, TUiWidgetData, TWidgetData } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import type { CameraService, SelectionService } from '@vibecanvas/canvas/services';
import { ELEMENT_DATA_ATTR } from '@vibecanvas/canvas/core/CONSTANTS';
import { isKonvaGroup, isKonvaRect, isKonvaText } from '@vibecanvas/canvas/core/GUARDS';
import type { WidgetManagerService, TWidgetActorEvent } from './WidgetManagerService';
import type { TWidgetBrowserPort, TWidgetTransportPort } from '../ports';
import {
  WIDGET_DOM_CONTENT_SCALE,
  WIDGET_DOM_PORTAL_FULLSCREEN_Z_INDEX,
  WIDGET_HOST_BODY_ID,
  WIDGET_HOST_BORDER_ID,
  WIDGET_HOST_HEADER_HEIGHT,
  WIDGET_HOST_MENU_BUTTON_RIGHT_INSET,
  WIDGET_HOST_MENU_BUTTON_SIZE,
  WIDGET_HOST_TITLE_ID,
  WIDGET_HOST_TITLE_MENU_GAP,
  WIDGET_WINDOW_CONTAINED,
  WIDGET_WINDOW_FULLSCREEN,
} from './CONSTANTS';
import type { IWidgetConfig, TWidgetRenderCleanup, TWidgetTitleBarActionState, TWidgetTitleBarPortal } from './interface';
import type { TWidgetError } from '@vibecanvas/service-db/model';
import { txRenderWidgetError } from './tx.render-widget-error';
import { txRenderWidgetLoading } from './tx.render-widget-loading';
// @ts-ignore keep this way as rules should not applied for this import
import { mountArrowSandbox } from './mount-arrow-sandbox';

type TPortal = {
  node: unknown;
  document: typeof document;
  browser: TWidgetBrowserPort;
  widgetServie: WidgetManagerService;
  widgetPortal: HTMLDivElement;
  cameraService: CameraService;
  selectionService?: SelectionService;
  widgetConfig?: IWidgetConfig;
  transport?: TWidgetTransportPort
};

type TArgs = {
  element: TElement;
};

type TWidgetActorEventHandler = (event: TWidgetActorEvent) => void;

const WIDGET_TITLE_ACTION_GAP = 4;
const WIDGET_TITLE_ACTION_HORIZONTAL_PADDING = 8;
const WIDGET_TITLE_ACTION_MIN_WIDTH = 44;
const WIDGET_TITLE_ACTION_CHARACTER_WIDTH = 7;

function titleActionWidth(label: string) {
  return Math.max(
    WIDGET_TITLE_ACTION_MIN_WIDTH,
    label.length * WIDGET_TITLE_ACTION_CHARACTER_WIDTH + WIDGET_TITLE_ACTION_HORIZONTAL_PADDING * 2,
  );
}

function syncWidgetRootChildren(contentRoot: HTMLDivElement) {
  const view = contentRoot.ownerDocument.defaultView;
  if (!view) return;

  Array.from(contentRoot.children).forEach((child) => {
    if (!(child instanceof view.HTMLElement)) return;

    child.style.boxSizing = 'border-box';
    child.style.width = '100%';
    child.style.minWidth = '100%';
    child.style.minHeight = '100%';
  });
}

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
  const contentRoot = portal.document.createElement('div');
  const fullscreenHeader = portal.document.createElement('div');
  const fullscreenTitle = portal.document.createElement('div');
  const fullscreenWindowButton = portal.document.createElement('button');
  const titleActionsRoot = portal.document.createElement('div');
  const widgetLabel = portal.widgetConfig?.getTitle?.(args.element)
    ?? portal.widgetConfig?.tool?.label
    ?? (args.element.data.type === 'widget' || args.element.data.type === 'ui-widget' ? args.element.data.kind : 'Widget');
  const titleActions = args.element.data.type === 'ui-widget'
    ? [...(portal.widgetConfig?.titleBarActions ?? [])]
    : [];
  const titleActionIds = new Set(titleActions.map((action) => action.id));
  const titleActionHandlers = new Map<string, () => void>();
  const titleActionButtons = new Map<string, HTMLButtonElement>();

  let disposed = false;
  let initialRenderTimer: unknown | null = null;
  let cleanupRender: TWidgetRenderCleanup | void = undefined;
  let hasNonRecoverableHostError = false;

  const setTitleActionState = (id: string, state: TWidgetTitleBarActionState) => {
    const button = titleActionButtons.get(id);
    if (!button) return;

    if (state.pressed !== undefined) {
      button.setAttribute('aria-pressed', String(state.pressed));
      button.style.background = state.pressed
        ? 'color-mix(in srgb, currentColor 14%, transparent)'
        : 'transparent';
      button.style.boxShadow = state.pressed ? 'inset 0 0 0 1px currentColor' : 'none';
    }
    if (state.disabled !== undefined) {
      button.disabled = state.disabled;
      button.style.opacity = state.disabled ? '0.5' : '1';
    }
    if (state.label !== undefined) {
      button.textContent = state.label;
      button.title = state.label;
      button.setAttribute('aria-label', state.label);
    }
  };

  const titleBarPortal: TWidgetTitleBarPortal | undefined = titleActions.length > 0
    ? {
      onAction(id, handler) {
        if (!titleActionIds.has(id)) return () => undefined;
        titleActionHandlers.set(id, handler);
        return () => {
          if (titleActionHandlers.get(id) === handler) titleActionHandlers.delete(id);
        };
      },
      setActionState: setTitleActionState,
    }
    : undefined;

  titleActionsRoot.dataset.hostedWidgetRoot = 'true';
  titleActionsRoot.dataset.widgetTitleActionsFor = args.element.id;
  titleActionsRoot.style.alignItems = 'center';
  titleActionsRoot.style.boxSizing = 'border-box';
  titleActionsRoot.style.display = titleActions.length > 0 ? 'flex' : 'none';
  titleActionsRoot.style.gap = `${WIDGET_TITLE_ACTION_GAP}px`;
  titleActionsRoot.style.justifyContent = 'flex-end';
  titleActionsRoot.style.pointerEvents = 'none';
  titleActionsRoot.style.transformOrigin = '0 0';

  titleActions.forEach((action) => {
    const button = portal.document.createElement('button');
    button.dataset.widgetTitleActionId = action.id;
    button.type = 'button';
    button.textContent = action.label;
    button.title = action.label;
    button.setAttribute('aria-label', action.label);
    button.style.alignItems = 'center';
    button.style.appearance = 'none';
    button.style.background = 'transparent';
    button.style.border = '1px solid transparent';
    button.style.borderRadius = '4px';
    button.style.boxSizing = 'border-box';
    button.style.color = 'inherit';
    button.style.cursor = 'pointer';
    button.style.display = 'inline-flex';
    button.style.font = '600 12px/1 Inter, ui-sans-serif, system-ui, sans-serif';
    button.style.height = '22px';
    button.style.justifyContent = 'center';
    button.style.minWidth = `${WIDGET_TITLE_ACTION_MIN_WIDTH}px`;
    button.style.padding = `0 ${WIDGET_TITLE_ACTION_HORIZONTAL_PADDING}px`;
    button.style.pointerEvents = 'auto';
    button.style.whiteSpace = 'nowrap';
    button.onpointerdown = (event) => event.stopPropagation();
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      titleActionHandlers.get(action.id)?.();
    };
    titleActionButtons.set(action.id, button);
    titleActionsRoot.appendChild(button);
  });

  const renderError = (error: TWidgetError, replaceContent = true) => {
    if (!error.retryable) hasNonRecoverableHostError = true;
    if (replaceContent) {
      try { cleanupRender?.(); } catch { /* cleanup must not hide the host error */ }
      cleanupRender = undefined;
    }
    txRenderWidgetError({ document: portal.document }, { root: contentRoot, error, replaceContent });
  };
  const renderLoading = () => {
    if (hasNonRecoverableHostError) return;
    txRenderWidgetLoading({ document: portal.document }, { root: contentRoot });
  };

  const syncDiv = () => {
    if (disposed || !div.isConnected) return;
    if (!isKonvaGroup(portal.node)) return

    const matrix = body.getAbsoluteTransform().getMatrix();
    const widgetData = portal.node.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData | TWidgetData | undefined;
    const isWidgetHost = widgetData?.type === 'widget' || widgetData?.type === 'ui-widget';
    const isCollapsed = isWidgetHost && widgetData.expanded === false;
    const isFullscreen = isWidgetHost && widgetData.window === WIDGET_WINDOW_FULLSCREEN;
    const isActive = portal.selectionService?.focusedId === args.element.id;
    const title = portal.node.findOne(`#${WIDGET_HOST_TITLE_ID}`);
    const titleFill = isKonvaText(title) ? title.fill() : undefined;
    const titleColor = typeof titleFill === 'string' ? titleFill : '#111827';
    const actionWidth = titleActions.reduce((width, action) => {
      return width + titleActionWidth(titleActionButtons.get(action.id)?.textContent ?? action.label);
    }, Math.max(0, titleActions.length - 1) * WIDGET_TITLE_ACTION_GAP);

    if (isKonvaText(title) && titleActions.length > 0) {
      const menuButtonX = Math.max(0, portal.node.width() - WIDGET_HOST_MENU_BUTTON_RIGHT_INSET - WIDGET_HOST_MENU_BUTTON_SIZE);
      title.width(Math.max(0, menuButtonX - actionWidth - WIDGET_HOST_TITLE_MENU_GAP * 2 - title.x()));
      title.getLayer()?.batchDraw();
    }

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
      if (titleActions.length > 0) {
        fullscreenHeader.insertBefore(titleActionsRoot, fullscreenWindowButton);
        titleActionsRoot.style.position = 'static';
        titleActionsRoot.style.width = 'auto';
        titleActionsRoot.style.height = `${WIDGET_HOST_HEADER_HEIGHT}px`;
        titleActionsRoot.style.marginLeft = '8px';
        titleActionsRoot.style.padding = '0';
        titleActionsRoot.style.transform = 'none';
        titleActionsRoot.style.color = '#f9fafb';
      }
      div.style.top = `${WIDGET_HOST_HEADER_HEIGHT}px`;
      div.style.width = `${fullscreenParent.clientWidth}px`;
      div.style.height = `${Math.max(0, fullscreenParent.clientHeight - WIDGET_HOST_HEADER_HEIGHT)}px`;
      contentRoot.style.width = `${fullscreenParent.clientWidth}px`;
      contentRoot.style.height = `${Math.max(0, fullscreenParent.clientHeight - WIDGET_HOST_HEADER_HEIGHT)}px`;
      contentRoot.style.transform = 'none';
      syncWidgetRootChildren(contentRoot);
      div.style.transform = 'none';
      div.style.zIndex = WIDGET_DOM_PORTAL_FULLSCREEN_Z_INDEX;
      return;
    }

    portal.widgetPortal.style.zIndex = '';
    fullscreenHeader.style.display = 'none';
    fullscreenHeader.style.zIndex = '';
    div.style.top = '0';
    div.style.zIndex = '';
    if (titleActions.length > 0) {
      if (titleActionsRoot.parentElement !== portal.widgetPortal) portal.widgetPortal.appendChild(titleActionsRoot);
      titleActionsRoot.style.position = 'absolute';
      titleActionsRoot.style.left = '0';
      titleActionsRoot.style.top = '0';
      titleActionsRoot.style.width = `${portal.node.width()}px`;
      titleActionsRoot.style.height = `${WIDGET_HOST_HEADER_HEIGHT}px`;
      titleActionsRoot.style.marginLeft = '0';
      titleActionsRoot.style.padding = `0 ${WIDGET_HOST_MENU_BUTTON_RIGHT_INSET + WIDGET_HOST_MENU_BUTTON_SIZE + WIDGET_HOST_TITLE_MENU_GAP}px 0 0`;
      titleActionsRoot.style.transform = `matrix(${portal.node.getAbsoluteTransform().getMatrix().join(',')})`;
      titleActionsRoot.style.color = titleColor;
    }
    div.style.width = `${body.width()}px`;
    div.style.height = `${body.height()}px`;
    contentRoot.style.width = `${body.width() / WIDGET_DOM_CONTENT_SCALE}px`;
    contentRoot.style.height = `${body.height() / WIDGET_DOM_CONTENT_SCALE}px`;
    contentRoot.style.transform = `scale(${WIDGET_DOM_CONTENT_SCALE})`;
    syncWidgetRootChildren(contentRoot);
    div.style.transform = `matrix(${matrix.join(',')})`;
  };

  const removeCameraListener = portal.cameraService.hooks.change.tap(syncDiv);
  const removeSelectionListener = portal.selectionService?.hooks.change.tap(syncDiv) ?? (() => undefined);
  const stopActiveDomEvent = (event: Event) => {
    if (div.style.pointerEvents !== 'auto') return;
    event.stopPropagation();
  };
  const domEventTypes = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'dblclick', 'wheel', 'keydown', 'keyup', 'contextmenu'];
  domEventTypes.forEach((eventType) => div.addEventListener(eventType, stopActiveDomEvent));

  portal.node.on('dragmove', syncDiv);

  const removeListener = (() => {
    if (!isKonvaGroup(portal.node)) return;
    if (disposed) return;

    disposed = true;
    removeCameraListener();
    removeSelectionListener();
    if (initialRenderTimer !== null) {
      portal.browser.clearTimeout(initialRenderTimer);
    }
    portal.node.off('dragmove', syncDiv);
    portal.node.off('destroy', onNodeDestroy);
    domEventTypes.forEach((eventType) => div.removeEventListener(eventType, stopActiveDomEvent));
    try { cleanupRender?.(); } catch { /* portal removal must remain reliable */ }
    cleanupRender = undefined;
    titleActionHandlers.clear();
    titleActionsRoot.remove();
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
  fullscreenHeader.style.justifyContent = 'space-between';
  fullscreenHeader.style.boxSizing = 'border-box';
  fullscreenHeader.style.padding = '0 10px';
  fullscreenHeader.style.backgroundColor = '#111827';
  fullscreenHeader.style.borderBottom = '1px solid #374151';
  fullscreenHeader.style.pointerEvents = 'auto';

  fullscreenTitle.textContent = widgetLabel;
  fullscreenTitle.style.flex = '1 1 auto';
  fullscreenTitle.style.minWidth = '0';
  fullscreenTitle.style.overflow = 'hidden';
  fullscreenTitle.style.textOverflow = 'ellipsis';
  fullscreenTitle.style.whiteSpace = 'nowrap';
  fullscreenTitle.style.color = '#f9fafb';
  fullscreenTitle.style.fontSize = '12px';
  fullscreenTitle.style.fontWeight = '600';

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
  fullscreenWindowButton.style.flex = '0 0 auto';
  fullscreenWindowButton.style.whiteSpace = 'nowrap';
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
  fullscreenHeader.appendChild(fullscreenTitle);
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

  contentRoot.style.position = 'absolute';
  contentRoot.style.left = '0';
  contentRoot.style.top = '0';
  contentRoot.style.transformOrigin = '0 0';
  contentRoot.style.transform = `scale(${WIDGET_DOM_CONTENT_SCALE})`;
  contentRoot.style.overflow = 'auto';

  div.appendChild(contentRoot);
  portal.widgetPortal.appendChild(fullscreenHeader);
  portal.widgetPortal.appendChild(div);
  if (titleActions.length > 0) portal.widgetPortal.appendChild(titleActionsRoot);
  try {
    cleanupRender = portal.widgetConfig?.renderDom?.({ root: contentRoot, element: args.element, titleBar: titleBarPortal });
  } catch (error) {
    renderError({
      phase: 'dom-render',
      code: 'WIDGET_RENDER_FAILED',
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
    });
  }
  syncWidgetRootChildren(contentRoot);

  if (portal.widgetConfig?.sandbox) {
    try {
      if (!portal.transport) throw new Error('Widget transport is unavailable.');
      const cleanupSandbox = mountArrowSandbox({
      root: contentRoot,
      browser: portal.browser,
      transport: portal.transport,
      subscribeActorInstanceEvents: (actorInstanceId: string, handler: TWidgetActorEventHandler) => {
        return portal.widgetServie.subscribeActorInstanceEvents(actorInstanceId, handler);
      },
      getActorInstanceId: () => {
        if (!isKonvaGroup(portal.node)) return null;
        const widgetData = portal.node.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData | TWidgetData | undefined;
        return widgetData?.type === 'widget' ? widgetData.actorInstanceId ?? null : null;
      },
      onLoading: renderLoading,
      onError: (error) => renderError(error, false),
      onRecovered: () => {
        if (!hasNonRecoverableHostError) {
          contentRoot.querySelector('[data-widget-host-error]')?.remove();
          contentRoot.querySelector('[data-widget-host-loading]')?.remove();
        }
      },
    }, { element: args.element, sandbox: portal.widgetConfig.sandbox });
      const cleanupDomRender = cleanupRender;
      cleanupRender = () => {
        try { cleanupDomRender?.(); } finally { cleanupSandbox(); }
      };
    } catch (error) {
      renderError({
        phase: 'sandbox-compile',
        code: 'WIDGET_SANDBOX_MOUNT_FAILED',
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      });
    }
  } else if (!portal.widgetConfig?.renderDom) {
    const definitionError = portal.widgetServie.getWidgetError?.(args.element);
    if (definitionError) renderError(definitionError);
    else renderLoading();
  }

  initialRenderTimer = portal.browser.setTimeout(syncDiv, 0);

  return removeListener;
}
