import { CANVAS_WIDGET_EXTENSION_KEY } from '@omnidraw/canvas-contract/CONSTANTS';
import { describe, expect, test } from 'vitest';
import {
  fnAiWidgetPayload,
  fnAiWidgetPayloadEquals,
  fnCanvasWidgetExtension,
  fnCanvasWidgetMountSignature,
  fnCreateAiWidgetNode,
  fnCreatePreviewWidgetNode,
  fnCreatePublishedWidgetNode,
  fnPreviewWidgetAppearanceMatches,
  fnWithPreviewWidgetAppearance,
  fnWithAiWidgetPayload,
} from '../../src/canvas-extension/fn.canvas-widget';

const base = {
  id: 'node-1',
  parentId: null,
  orderKey: 'a',
  position: { x: 10, y: 20 },
  size: { width: 360, height: 240 },
  title: 'Widget',
} as const;

const previewTitleBarColor = {
  space: 'srgb' as const,
  r: 217 / 255,
  g: 119 / 255,
  b: 6 / 255,
  a: 1,
};

describe('direct Cangine widget nodes', () => {
  test('creates a published widget with exact transactional identity', () => {
    const node = fnCreatePublishedWidgetNode({
      ...base,
      instanceId: 'instance-1',
      widgetKey: 'counter',
      resourceBindings: {
        records: {
          resourceId: 'resource-1',
          allowRead: true,
          allowWrite: false,
        },
      },
    });

    expect(node.kind).toBe('widget-frame');
    expect(node.portal.portalId).toBe('omnidraw:widget:node-1');
    expect(fnCanvasWidgetExtension(node)).toEqual({
      schemaVersion: 1,
      type: 'widget-instance',
      instanceId: 'instance-1',
      widgetKey: 'counter',
      resourceBindings: {
        records: {
          resourceId: 'resource-1',
          allowRead: true,
          allowWrite: false,
        },
      },
    });
  });

  test('changes the published mount signature when its catalog epoch advances', () => {
    const node = fnCreatePublishedWidgetNode({
      ...base,
      instanceId: 'instance-1',
      widgetKey: 'counter',
    });

    expect(fnCanvasWidgetMountSignature(node, { global: 0, widget: 2 }))
      .not.toBe(fnCanvasWidgetMountSignature(node, { global: 0, widget: 1 }));
    expect(fnCanvasWidgetMountSignature(node, { global: 1, widget: 1 }))
      .not.toBe(fnCanvasWidgetMountSignature(node, { global: 0, widget: 1 }));
  });

  test('declares the bounded trailing Preview actions dropdown', () => {
    const node = fnCreatePreviewWidgetNode({
      ...base,
      instanceId: 'preview-1',
      widgetKey: 'counter',
      titleBarColor: previewTitleBarColor,
    });

    expect(node.title).toBe('Preview: Widget');
    expect(node.titleBarColor).toEqual(previewTitleBarColor);
    expect(node.headerItems).toEqual([{
      type: 'dropdown',
      id: 'preview-actions',
      label: 'Preview actions',
      content: { type: 'text', text: '•••' },
      items: [
        { id: 'reload', text: 'Reload' },
        { id: 'rebuild', text: 'Rebuild' },
        { id: 'publish', text: 'Publish' },
        { id: 'remove', text: 'Remove' },
      ],
    }]);
    expect(JSON.stringify(node)).not.toContain('function');
  });

  test('normalizes existing Preview chrome without duplicating its prefix', () => {
    const preview = fnCreatePreviewWidgetNode({
      ...base,
      instanceId: 'preview-1',
      widgetKey: 'counter',
      titleBarColor: previewTitleBarColor,
    });

    expect(fnWithPreviewWidgetAppearance(preview, previewTitleBarColor).title)
      .toBe('Preview: Widget');
    const legacy = {
      ...preview,
      title: 'Legacy title',
      titleBarColor: undefined,
    };
    expect(fnPreviewWidgetAppearanceMatches(preview, previewTitleBarColor))
      .toBe(true);
    expect(fnPreviewWidgetAppearanceMatches(legacy, previewTitleBarColor))
      .toBe(false);
    expect(fnWithPreviewWidgetAppearance(legacy, previewTitleBarColor)).toMatchObject({
      title: 'Preview: Legacy title',
      titleBarColor: previewTitleBarColor,
    });
  });

  test('keeps AI preferences in the namespaced extension', () => {
    const node = fnCreateAiWidgetNode({ ...base, sessionId: 'session-1' });
    const changed = fnWithAiWidgetPayload(node, {
      sessionId: 'session-1',
      model: { provider: 'openai', modelId: 'gpt-5' },
      thinkingLevel: 'high',
    });

    expect(fnAiWidgetPayload(changed)).toMatchObject({
      sessionId: 'session-1',
      thinkingLevel: 'high',
    });
    expect(changed.extensions?.[CANVAS_WIDGET_EXTENSION_KEY]).toBeDefined();
    expect(fnAiWidgetPayloadEquals(changed, {
      thinkingLevel: 'high',
      model: { modelId: 'gpt-5', provider: 'openai' },
      sessionId: 'session-1',
    })).toBe(true);
    expect(fnAiWidgetPayloadEquals(changed, {
      sessionId: 'session-2',
    })).toBe(false);
  });
});
