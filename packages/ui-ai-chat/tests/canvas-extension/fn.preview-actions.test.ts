import { describe, expect, test } from 'vitest';
import {
  fnCreatePreviewWidgetNode,
  fnCreatePublishedWidgetNode,
} from '../../src/canvas-extension/fn.canvas-widget';
import {
  fnPreviewActionTarget,
  fnPreviewPresentedMenuItems,
  fnPreviewPublicationResolution,
} from '../../src/canvas-extension/fn.preview-actions';
import {
  publicCatalog,
  publicEntry,
  publicForm,
} from '../widget-public-catalog.fixture';

const node = fnCreatePreviewWidgetNode({
  id: 'preview-1',
  parentId: null,
  orderKey: 'a',
  position: { x: 0, y: 0 },
  size: { width: 360, height: 320 },
  title: 'Camera',
  instanceId: 'instance-1',
  widgetKey: 'camera',
  titleBarColor: { space: 'srgb', r: 1, g: 0.5, b: 0, a: 1 },
});

describe('Preview action policy', () => {
  test('routes only enabled actions on the current Preview dropdown', () => {
    expect(fnPreviewActionTarget(node, {
      type: 'dropdown-item',
      widgetId: node.id,
      itemId: 'preview-actions',
      dropdownItemId: 'reload',
    })).toEqual({ action: 'reload', widgetId: 'preview-1', widgetKey: 'camera' });
    expect(fnPreviewActionTarget(node, {
      type: 'dropdown-item',
      widgetId: node.id,
      itemId: 'other',
      dropdownItemId: 'reload',
    })).toBeNull();
    expect(fnPreviewActionTarget(null, {
      type: 'dropdown-item',
      widgetId: node.id,
      itemId: 'preview-actions',
      dropdownItemId: 'reload',
    })).toBeNull();
    const disabled = {
      ...node,
      headerItems: [{
        ...node.headerItems![0]!,
        disabled: true,
      }],
    };
    expect(fnPreviewActionTarget(disabled, {
      type: 'dropdown-item',
      widgetId: node.id,
      itemId: 'preview-actions',
      dropdownItemId: 'reload',
    })).toBeNull();
    const disabledItem = {
      ...node,
      headerItems: [{
        ...node.headerItems![0]!,
        items: node.headerItems![0]!.type === 'dropdown'
          ? node.headerItems![0]!.items.map((item) => (
            item.id === 'reload' ? { ...item, disabled: true } : item
          ))
          : [],
      }],
    };
    expect(fnPreviewActionTarget(disabledItem, {
      type: 'dropdown-item',
      widgetId: node.id,
      itemId: 'preview-actions',
      dropdownItemId: 'reload',
    })).toBeNull();
    const published = fnCreatePublishedWidgetNode({
      id: node.id,
      parentId: null,
      orderKey: 'a',
      position: { x: 0, y: 0 },
      size: { width: 360, height: 320 },
      title: 'Camera',
      instanceId: 'instance-1',
      widgetKey: 'camera',
      resourceBindings: [],
    });
    expect(fnPreviewActionTarget({
      ...published,
      headerItems: node.headerItems,
    }, {
      type: 'dropdown-item',
      widgetId: node.id,
      itemId: 'preview-actions',
      dropdownItemId: 'reload',
    })).toBeNull();
  });

  test('adds the one visual separator and destructive presentation at the edge', () => {
    expect(fnPreviewPresentedMenuItems(node.headerItems![0]!.type === 'dropdown'
      ? node.headerItems![0]!.items
      : [])).toEqual([
      { id: 'reload', text: 'Reload' },
      { id: 'rebuild', text: 'Rebuild' },
      { id: 'publish', text: 'Publish' },
      { id: 'remove', text: 'Remove', destructive: true, separatorBefore: true },
    ]);
  });

  test('resolves current manifest and catalog digest fences', () => {
    expect(fnPreviewPublicationResolution(publicCatalog(), 'camera')).toEqual({
      ok: true,
      input: {
        widgetKey: 'camera',
        expectedManifestDigestSha256: 'a'.repeat(64),
        expectedCatalogDigestSha256: 'a'.repeat(64),
      },
    });
  });

  test('rejects missing and unhealthy drafts before publication', () => {
    expect(fnPreviewPublicationResolution(publicCatalog([
      publicEntry('camera', { draft: null }),
    ]), 'camera')).toMatchObject({ ok: false });
    expect(fnPreviewPublicationResolution(publicCatalog([
      publicEntry('camera', {
        draft: publicForm('draft', { health: 'unhealthy' }),
      }),
    ]), 'camera')).toMatchObject({ ok: false });
  });
});
