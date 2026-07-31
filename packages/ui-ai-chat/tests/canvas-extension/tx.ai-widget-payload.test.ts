import type { IStandardCanvasEditor } from '@omnidraw/cangine/editor';
import { describe, expect, test, vi } from 'vitest';
import {
  fnCreateAiWidgetNode,
} from '../../src/canvas-extension/fn.canvas-widget';
import {
  txPersistAiWidgetPayload,
} from '../../src/canvas-extension/tx.ai-widget-payload';

const base = {
  id: 'node-1',
  parentId: null,
  orderKey: 'a',
  position: { x: 10, y: 20 },
  size: { width: 360, height: 240 },
  title: 'Widget',
} as const;

describe('AI widget payload transaction', () => {
  test('does not dispatch an identical payload', () => {
    const commitSceneMutation = vi.fn();
    const editor = { commitSceneMutation } as unknown as IStandardCanvasEditor;
    const node = fnCreateAiWidgetNode({ ...base, sessionId: 'session-1' });

    txPersistAiWidgetPayload({ editor }, {
      node,
      payload: { sessionId: 'session-1' },
    });

    expect(commitSceneMutation).not.toHaveBeenCalled();
  });

  test('dispatches one controlled mutation for a changed payload', () => {
    const commitSceneMutation = vi.fn();
    const editor = { commitSceneMutation } as unknown as IStandardCanvasEditor;
    const node = fnCreateAiWidgetNode({ ...base, sessionId: 'session-1' });

    txPersistAiWidgetPayload({ editor }, {
      node,
      payload: {
        sessionId: 'session-1',
        thinkingLevel: 'high',
      },
    });

    expect(commitSceneMutation).toHaveBeenCalledTimes(1);
    expect(commitSceneMutation).toHaveBeenCalledWith({
      source: 'omnidraw:ai-chat',
      commands: [{
        type: 'upsert',
        node: expect.objectContaining({
          id: node.id,
          extensions: expect.objectContaining({
            'omnidraw:widget': expect.objectContaining({
              payload: {
                sessionId: 'session-1',
                thinkingLevel: 'high',
              },
            }),
          }),
        }),
      }],
    });
  });
});
