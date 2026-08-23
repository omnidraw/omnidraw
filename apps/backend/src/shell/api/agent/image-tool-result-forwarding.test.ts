import { describe, expect, test } from 'bun:test';
import { fnToolSuccessWithPng } from '#backend/shell/agent/tools/fn.result';
import { apiChatHistory } from './api.chat.history';
import { apiAgentEvents } from './api.events';

const SYNTHETIC_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4nGP4z8DwHwwZGP6DAQBJyAn3FGMynQAAAABJRU5ErkJggg==';

function createToolResultMessage() {
  const result = fnToolSuccessWithPng({
    summary: 'Synthetic image transport proof.',
    modelData: { width: 2, height: 2 },
    details: { fixture: 'synthetic-2x2-png' },
    image: { mimeType: 'image/png', data: SYNTHETIC_PNG_BASE64 },
  });
  return {
    role: 'toolResult' as const,
    toolCallId: 'tool-call-1',
    toolName: 'synthetic_image_transport_proof',
    content: result.content,
    details: result.details,
    isError: false,
    timestamp: 1,
  };
}

describe('agent API PNG tool-result forwarding', () => {
  test('history projection preserves the supported content block without duplicating its data', async () => {
    const message = createToolResultMessage();
    const historyItems = [{ entryId: 'tool-entry-1', message }];
    const history = apiChatHistory.callable({
      context: {
        agent: { getChatHistory: () => historyItems },
      } as never,
    });

    const forwarded = await history({ widgetId: 'widget-1', sessionId: 'session-1' });

    expect(forwarded).toEqual(historyItems);
    expect(forwarded[0]?.message).toEqual(message);
    expect(message.content[0]?.type === 'text' ? message.content[0].text : '')
      .not.toContain(SYNTHETIC_PNG_BASE64);
    expect(JSON.stringify(message.details)).not.toContain(SYNTHETIC_PNG_BASE64);
  });

  test('event streaming preserves the exact PNG tool-result message', async () => {
    const message = createToolResultMessage();
    const envelope = {
      widgetId: 'widget-1',
      sessionId: 'session-1',
      event: { type: 'message_end' as const, message },
    };
    const subscribe = apiAgentEvents.callable({
      context: {
        eventPublisher: {
          async *subscribeAgentEventRecords() {
            yield { event: envelope, sequence: 1 };
          },
        },
      } as never,
    });
    const events = await subscribe({});

    expect(await events.next()).toEqual({
      done: false,
      value: { ...envelope, sequence: 1 },
    });
    await events.return(undefined);
  });
});
