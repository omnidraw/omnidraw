import type { TSceneNode, TWidgetDropdownItem } from '@omnidraw/cangine';
import type { TWidgetActivation } from '@omnidraw/cangine/editor';
import type {
  TWidgetPublicCatalog,
} from '@omnidraw/orpc-client';
import {
  PREVIEW_ACTION_IDS,
  PREVIEW_ACTIONS_HEADER_ID,
} from './CONSTANTS';
import { fnCanvasWidgetExtension } from './fn.canvas-widget';

export type TPreviewAction = keyof typeof PREVIEW_ACTION_IDS;

export type TPreviewActionTarget = Readonly<{
  action: TPreviewAction;
  widgetId: string;
  widgetKey: string;
}>;

export type TPreviewPublicationInput = Readonly<{
  widgetKey: string;
  expectedManifestDigestSha256: string;
  expectedCatalogDigestSha256: string;
}>;

export type TPreviewPublicationResolution = Readonly<{
  ok: true;
  input: TPreviewPublicationInput;
}> | Readonly<{
  ok: false;
  message: string;
}>;

type TPreviewPresentedMenuItem = Readonly<{
  id: string;
  text: string;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
}>;

export function fnPreviewActionTarget(
  node: Readonly<TSceneNode> | null | undefined,
  activation: Readonly<TWidgetActivation>,
): TPreviewActionTarget | null {
  if (
    activation.type !== 'dropdown-item'
    || activation.itemId !== PREVIEW_ACTIONS_HEADER_ID
    || node?.kind !== 'widget-frame'
    || node.id !== activation.widgetId
  ) return null;
  const extension = fnCanvasWidgetExtension(node);
  if (extension?.type !== 'widget-preview') return null;
  const dropdown = node.headerItems?.find(
    (item) => item.type === 'dropdown' && item.id === activation.itemId,
  );
  if (dropdown?.type !== 'dropdown' || dropdown.disabled === true) return null;
  const item = dropdown.items.find(
    (candidate) => candidate.id === activation.dropdownItemId,
  );
  if (item === undefined || item.disabled === true) return null;
  const action = Object.entries(PREVIEW_ACTION_IDS).find(
    ([, id]) => id === item.id,
  )?.[0] as TPreviewAction | undefined;
  if (action === undefined) return null;
  return Object.freeze({
    action,
    widgetId: node.id,
    widgetKey: extension.widgetKey,
  });
}

export function fnPreviewPresentedMenuItems(
  items: readonly Readonly<TWidgetDropdownItem>[],
): readonly TPreviewPresentedMenuItem[] {
  return Object.freeze(items.map((item) => Object.freeze({
    id: item.id,
    text: item.text,
    ...(item.disabled === undefined ? {} : { disabled: item.disabled }),
    ...(item.id === PREVIEW_ACTION_IDS.remove
      ? { destructive: true, separatorBefore: true }
      : {}),
  })));
}

export function fnPreviewPublicationResolution(
  catalog: Readonly<TWidgetPublicCatalog>,
  widgetKey: string,
): TPreviewPublicationResolution {
  const entry = catalog.entries.find(
    (candidate) => candidate.widgetKey === widgetKey,
  );
  if (entry?.draft == null) {
    return Object.freeze({
      ok: false,
      message: `Widget draft '${widgetKey}' is no longer available.`,
    });
  }
  if (entry.draft.health !== 'healthy') {
    return Object.freeze({
      ok: false,
      message: `Widget draft '${widgetKey}' is unhealthy and cannot be published.`,
    });
  }
  if (entry.draft.manifestDigestSha256 === null) {
    return Object.freeze({
      ok: false,
      message: `Widget draft '${widgetKey}' has no current manifest digest.`,
    });
  }
  return Object.freeze({
    ok: true,
    input: Object.freeze({
      widgetKey,
      expectedManifestDigestSha256: entry.draft.manifestDigestSha256,
      expectedCatalogDigestSha256: catalog.catalogDigestSha256,
    }),
  });
}
