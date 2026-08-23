import { describe, expect, test } from 'bun:test';
import { Effect, Stream } from 'effect';
import { EventProgramError } from '../../core/events/service.events';
import { FunctionProgramError } from '../../core/functions/service.functions';
import { ResourceError } from '../../core/resources/ResourceError';
import {
  eventAuthorityFromLive,
  functionAuthorityFromLive,
  resourceAuthorityFromLive,
} from './layer.semantic-authorities';

const functionRequest = {
  subject: { canvasId: 'canvas-1', elementId: 'element-1', widgetInstanceId: 'instance-1' },
  widgetKey: 'counter',
  catalogGeneration: 1,
  functionName: 'increment',
  input: {},
} as const;

describe('live semantic authority failure boundaries', () => {
  test('preserves a known feature failure with details exactly once', async () => {
    const expected = new FunctionProgramError(
      'FUNCTION_NOT_FOUND',
      'Function was not found.',
      { functionName: 'increment' },
    );
    const authority = functionAuthorityFromLive({
      invokeFunction: async () => { throw expected; },
    } as never);
    const failure = await Effect.runPromise(Effect.flip(authority.invoke(functionRequest)));
    expect(failure).toBe(expected);
    expect(failure.details).toEqual({ functionName: 'increment' });
  });

  test('does not forward an arbitrary provider code into the semantic channel', async () => {
    const authority = functionAuthorityFromLive({
      invokeFunction: async () => {
        throw Object.assign(new Error('provider failed'), { code: 'PROVIDER_SECRET_CODE' });
      },
    } as never);
    const failure = await Effect.runPromise(Effect.flip(authority.invoke(functionRequest)));
    expect(failure).toMatchObject({
      _tag: 'FunctionProgramError',
      code: 'FUNCTION_UNAVAILABLE',
      details: {},
    });
    expect(failure.cause).toMatchObject({ code: 'PROVIDER_SECRET_CODE' });
  });

  test('preserves event semantics but collapses plain coded protocol failures', async () => {
    const expected = new EventProgramError(
      'EVENT_CURSOR_INVALID',
      'Cursor is ahead.',
      { afterSequence: 4, currentSequence: 2 },
    );
    const known = eventAuthorityFromLive({
      subscribeAgentEventRecords: () => ({
        async *[Symbol.asyncIterator]() { throw expected; },
      }),
    } as never);
    const knownStream = await Effect.runPromise(known.agent({ afterSequence: 4 }));
    await expect(Effect.runPromise(Effect.flip(Stream.runHead(knownStream)))).resolves.toBe(expected);

    const unknown = eventAuthorityFromLive({
      subscribeAgentEventRecords: () => ({
        async *[Symbol.asyncIterator]() {
          throw Object.assign(new Error('protocol failed'), { code: 'EVENT_CURSOR_INVALID' });
        },
      }),
    } as never);
    const unknownStream = await Effect.runPromise(unknown.agent({ afterSequence: 4 }));
    await expect(Effect.runPromise(Effect.flip(Stream.runHead(unknownStream)))).resolves.toMatchObject({
      _tag: 'EventProgramError',
      code: 'EVENT_UNAVAILABLE',
      details: {},
    });
  });

  test('translates the feature-owned resource shell error and retains safe details', async () => {
    const authority = resourceAuthorityFromLive({
      createResource: async () => {
        throw new ResourceError('RESOURCE_NAME_CONFLICT', 'Duplicate.', { resourceName: 'Shared' });
      },
    } as never);
    const failure = await Effect.runPromise(Effect.flip(authority.create({ kind: 'kv', name: 'Shared' })));
    expect(failure).toMatchObject({
      _tag: 'ResourceProgramError',
      code: 'RESOURCE_NAME_CONFLICT',
      details: { resourceName: 'Shared' },
    });
    expect(failure.cause).toBeInstanceOf(ResourceError);
  });
});
