import { CANVAS_WIDGET_EXTENSION_KEY } from '@omnidraw/canvas-contract/CONSTANTS';
import { describe, expect, test } from 'vitest';
import {
  fnAiWidgetPayload,
  fnAiWidgetPayloadEquals,
  fnCanvasWidgetExtension,
  fnCanvasWidgetMountSignature,
  fnCreateAiWidgetNode,
  fnCreatePublishedWidgetNode,
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
