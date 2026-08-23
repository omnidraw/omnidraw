import { describe, expect, test } from 'bun:test';
import {
  defineTool,
  SessionManager,
  sessionEntryToContextMessages,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { fnProjectActiveChatHistory } from '../fn.chat-history';
import { fnToolSuccessWithPng } from '../tools/fn.result';
import { createTestEvents } from './service.fixture';

const SYNTHETIC_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4nGP4z8DwHwwZGP6DAQBJyAn3FGMynQAAAABJRU5ErkJggg==';

type TMessageEnd = Extract<AgentSessionEvent, { type: 'message_end' }>;

function getImageData(message: TMessageEnd['message']): string | undefined {
  if (message.role !== 'toolResult') return undefined;
  return message.content.find((part) => part.type === 'image')?.data;
}

describe('PNG tool-result transport', () => {
  test('Pi execution, transcript, next-turn context, events, and history retain one image block', async () => {
    const tool = defineTool({
      name: 'synthetic_image_transport_proof',
      label: 'Synthetic Image Transport Proof',
      description: 'Test-only bounded image transport fixture.',
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() {
        return fnToolSuccessWithPng({
          summary: 'Synthetic image transport proof.',
          modelData: { width: 2, height: 2 },
          details: { fixture: 'synthetic-2x2-png' },
          image: { mimeType: 'image/png', data: SYNTHETIC_PNG_BASE64 },
        });
      },
    });
    const execution = await tool.execute('tool-call-1', {}, undefined, undefined, {} as never);
    const message: TMessageEnd['message'] = {
      role: 'toolResult',
      toolCallId: 'tool-call-1',
      toolName: tool.name,
      content: execution.content,
      details: execution.details,
      isError: false,
      timestamp: 1,
    };

    const session = SessionManager.inMemory('/synthetic-image-transport');
    const entryId = session.appendMessage(message);
    const entry = session.getEntry(entryId);
    if (!entry) throw new Error('Pi did not append the tool-result entry.');

    const projected = sessionEntryToContextMessages(entry);
    const nextTurn = session.buildSessionContext().messages;
    const history = fnProjectActiveChatHistory(
      session.buildContextEntries(),
      sessionEntryToContextMessages,
    );

    expect(projected).toEqual([message]);
    expect(getImageData(projected[0] as TMessageEnd['message'])).toBe(SYNTHETIC_PNG_BASE64);
    expect(nextTurn).toEqual([message]);
    expect(getImageData(nextTurn[0] as TMessageEnd['message'])).toBe(SYNTHETIC_PNG_BASE64);
    expect(history).toEqual([{ entryId, message }]);
    expect(getImageData(history[0]?.message as TMessageEnd['message'])).toBe(SYNTHETIC_PNG_BASE64);

    const events = createTestEvents();
    const iterator = events.subscribeAgentEvents()[Symbol.asyncIterator]();
    const nextEvent = iterator.next();
    events.publishAgentEvent({
      widgetId: 'widget-1',
      sessionId: 'session-1',
      event: { type: 'message_end', message },
    });
    const delivered = await nextEvent;
    if (delivered.done || 'kind' in delivered.value || delivered.value.event.type !== 'message_end') {
      throw new Error('Agent message event was not delivered.');
    }
    expect(getImageData(delivered.value.event.message)).toBe(SYNTHETIC_PNG_BASE64);
    await iterator.return?.();

    expect(execution.content[0]?.type).toBe('text');
    expect(execution.content[0]?.type === 'text' ? execution.content[0].text : '')
      .not.toContain(SYNTHETIC_PNG_BASE64);
    expect(JSON.stringify(execution.details)).not.toContain(SYNTHETIC_PNG_BASE64);
    expect(execution.content.filter((part) => part.type === 'image')).toHaveLength(1);
  });
});
