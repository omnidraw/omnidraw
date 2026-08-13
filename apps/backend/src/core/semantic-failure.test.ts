import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import { AgentProgramError } from './agent/service.agent';
import { CanvasAuthorityError } from './canvas/errors';
import { DatabaseProgramError } from './database/service.database';
import { EventProgramError } from './events/service.events';
import { FunctionProgramError } from './functions/service.functions';
import { ResourceError } from './resources/ResourceError';
import { ResourceProgramError } from './resources/service.resources';
import { WidgetStateProgramError } from './widget-state/service.widget-state';
import { WidgetProgramError } from './widgets/service.widgets';

describe('semantic failure codecs', () => {
  test('round-trips every feature tag with structured JSON details', () => {
    const details = { operation: 'test', retry: 2, nested: { safe: true } } as const;
    const cases = [
      [AgentProgramError, new AgentProgramError('CHAT_BUSY', 'busy', details)],
      [CanvasAuthorityError, new CanvasAuthorityError('CONFLICT', 'changed', details)],
      [DatabaseProgramError, new DatabaseProgramError('DATABASE_UNAVAILABLE', 'offline', details)],
      [EventProgramError, new EventProgramError('EVENT_CURSOR_INVALID', 'cursor', details)],
      [FunctionProgramError, new FunctionProgramError('FUNCTION_NOT_FOUND', 'missing', details)],
      [ResourceError, new ResourceError('RESOURCE_NAME_CONFLICT', 'duplicate', details)],
      [ResourceProgramError, new ResourceProgramError('RESOURCE_NOT_FOUND', 'missing', details)],
      [WidgetStateProgramError, new WidgetStateProgramError('WIDGET_STATE_UNAVAILABLE', 'offline', details)],
      [WidgetProgramError, new WidgetProgramError('WIDGET_CATALOG_CHANGED', 'changed', details)],
    ] as const;

    for (const [codec, error] of cases) {
      const encoded = Schema.encodeSync(codec as typeof AgentProgramError)(error as AgentProgramError);
      expect(encoded).toEqual({
        _tag: error._tag,
        code: error.code,
        message: error.message,
        details,
      });
      const decoded = Schema.decodeUnknownSync(codec as typeof AgentProgramError)(encoded);
      expect(decoded).toBeInstanceOf(codec);
      expect(decoded).toMatchObject(encoded);
    }
  });

  test('rejects unknown codes and non-JSON details at every feature codec', () => {
    const codecs = [
      [AgentProgramError, 'AGENT_UNAVAILABLE'],
      [CanvasAuthorityError, 'UNAVAILABLE'],
      [DatabaseProgramError, 'DATABASE_UNAVAILABLE'],
      [EventProgramError, 'EVENT_UNAVAILABLE'],
      [FunctionProgramError, 'FUNCTION_UNAVAILABLE'],
      [ResourceError, 'RESOURCE_UNAVAILABLE'],
      [ResourceProgramError, 'RESOURCE_UNAVAILABLE'],
      [WidgetStateProgramError, 'WIDGET_STATE_UNAVAILABLE'],
      [WidgetProgramError, 'WIDGET_UNAVAILABLE'],
    ] as const;
    for (const [codec, validCode] of codecs) {
      expect(() => Schema.decodeUnknownSync(codec as typeof AgentProgramError)({
        _tag: codec.name,
        code: 'UNBOUNDED_PROVIDER_CODE',
        message: 'unsafe',
        details: {},
      })).toThrow();
      expect(() => Schema.decodeUnknownSync(codec as typeof AgentProgramError)({
        _tag: codec.name,
        code: validCode,
        message: 'unsafe',
        details: { callback: () => undefined },
      })).toThrow();
    }
  });

  test('keeps diagnostic causes off the encoded contract', () => {
    const cause = new Error('provider details');
    const error = new EventProgramError('EVENT_UNAVAILABLE', 'Events are unavailable.', {}, { cause });
    expect(error.cause).toBe(cause);
    expect(Schema.encodeSync(EventProgramError)(error)).toEqual({
      _tag: 'EventProgramError',
      code: 'EVENT_UNAVAILABLE',
      message: 'Events are unavailable.',
      details: {},
    });
  });
});
