import type { TSceneNode } from '@omnidraw/cangine';
import type {
  ICanvasMenuController,
  TWidgetActivation,
} from '@omnidraw/cangine/editor';
import type { TCanvasNotificationPort } from '@omnidraw/canvas';
import type { TWidgetTransportPort } from '../ports';
import type { TWidgetPreviewOwner } from './preview-owner';
import {
  PREVIEW_ACTION_IDS,
  PREVIEW_ACTIONS_HEADER_ID,
} from './CONSTANTS';
import {
  fnPreviewActionTarget,
  fnPreviewPresentedMenuItems,
  fnPreviewPublicationResolution,
} from './fn.preview-actions';

type TCreatePreviewActionsArgs = Readonly<{
  transport: TWidgetTransportPort;
  menu: ICanvasMenuController;
  notification?: TCanvasNotificationPort;
  readNode(widgetId: string): Readonly<TSceneNode> | null;
  readOwner(widgetId: string): TWidgetPreviewOwner | null;
  remove(widgetId: string): void;
}>;

export type TPreviewActions = Readonly<{
  activate(activation: Readonly<TWidgetActivation>): Promise<void>;
  destroy(): void;
}>;

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  if (
    error !== null
    && typeof error === 'object'
    && 'message' in error
    && typeof error.message === 'string'
    && error.message.trim().length > 0
  ) return error.message.trim();
  return fallback;
}

export function createPreviewActions(
  args: TCreatePreviewActionsArgs,
): TPreviewActions {
  const publishingWidgetIds = new Set<string>();
  let disposed = false;
  let enhancingMenu = false;

  const targetIsCurrent = (
    widgetId: string,
    widgetKey: string,
    dropdownItemId: string,
  ): boolean => fnPreviewActionTarget(args.readNode(widgetId), {
    type: 'dropdown-item',
    widgetId,
    itemId: PREVIEW_ACTIONS_HEADER_ID,
    dropdownItemId,
  })?.widgetKey === widgetKey;

  const unsubscribeMenu = args.menu.subscribe((state) => {
    if (
      disposed
      || enhancingMenu
      || !state.open
      || state.id === null
      || state.anchor === null
      || state.data.headerItemId !== PREVIEW_ACTIONS_HEADER_ID
      || state.data.widgetId === undefined
      || !state.id.startsWith('widget-dropdown:')
    ) return;
    const remove = state.items.find(
      (item) => item.id === PREVIEW_ACTION_IDS.remove,
    );
    const target = fnPreviewActionTarget(
      args.readNode(state.data.widgetId),
      {
        type: 'dropdown-item',
        widgetId: state.data.widgetId,
        itemId: PREVIEW_ACTIONS_HEADER_ID,
        dropdownItemId: remove?.id ?? '',
      },
    );
    if (target === null) return;
    if (remove?.destructive === true && remove.separatorBefore === true) return;
    enhancingMenu = true;
    try {
      args.menu.open({
        id: state.id,
        anchor: state.anchor,
        items: fnPreviewPresentedMenuItems(state.items),
        data: state.data,
        ...(state.highlightedItemId === null
          ? {}
          : { initialItemId: state.highlightedItemId }),
      });
    } finally {
      enhancingMenu = false;
    }
  });

  const publish = async (
    widgetId: string,
    widgetKey: string,
  ): Promise<void> => {
    if (publishingWidgetIds.has(widgetId)) return;
    publishingWidgetIds.add(widgetId);
    args.notification?.showInfo(
      'Building and publishing widget…',
      `Validating the current ${widgetKey} draft.`,
    );
    try {
      const [catalogError, catalog] =
        await args.transport.api.widget.catalog.get();
      if (catalogError || !catalog) {
        throw catalogError ?? new Error('The widget catalog is unavailable.');
      }
      if (
        disposed
        || !targetIsCurrent(widgetId, widgetKey, PREVIEW_ACTION_IDS.publish)
      ) return;
      const resolution = fnPreviewPublicationResolution(catalog, widgetKey);
      if (!resolution.ok) throw new Error(resolution.message);
      const [publicationError] =
        await args.transport.api.widget.publication.buildAndPublish(
          resolution.input,
        );
      if (publicationError) throw publicationError;
      if (
        disposed
        || !targetIsCurrent(widgetId, widgetKey, PREVIEW_ACTION_IDS.publish)
      ) return;
      args.notification?.showSuccess(
        'Widget built and published',
        `${widgetKey} passed the current catalog and manifest digest fences.`,
      );
    } catch (error) {
      if (
        disposed
        || !targetIsCurrent(widgetId, widgetKey, PREVIEW_ACTION_IDS.publish)
      ) return;
      args.notification?.showError(
        'Could not build and publish',
        errorMessage(error, 'The widget draft could not be built and published.'),
      );
    } finally {
      publishingWidgetIds.delete(widgetId);
    }
  };

  return Object.freeze({
    async activate(activation) {
      if (disposed) return;
      const target = fnPreviewActionTarget(
        args.readNode(activation.widgetId),
        activation,
      );
      if (target === null) return;
      if (target.action === 'remove') {
        args.remove(target.widgetId);
        return;
      }
      if (target.action === 'publish') {
        await publish(target.widgetId, target.widgetKey);
        return;
      }
      const owner = args.readOwner(target.widgetId);
      if (owner === null) return;
      if (target.action === 'reload') await owner.reload();
      else await owner.rebuild();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      publishingWidgetIds.clear();
      unsubscribeMenu();
    },
  });
}
