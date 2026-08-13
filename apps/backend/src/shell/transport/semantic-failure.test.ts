import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import { AGENT_PROGRAM_ERROR_CODES, AgentProgramError } from '../../core/agent/service.agent';
import { CANVAS_AUTHORITY_ERROR_CODES, CanvasAuthorityError } from '../../core/canvas/errors';
import { DATABASE_PROGRAM_ERROR_CODES, DatabaseProgramError } from '../../core/database/service.database';
import { EVENT_PROGRAM_ERROR_CODES, EventProgramError } from '../../core/events/service.events';
import { FUNCTION_PROGRAM_ERROR_CODES, FunctionProgramError } from '../../core/functions/service.functions';
import { ResourceError } from '../../core/resources/ResourceError';
import { ResourceProgramError } from '../../core/resources/service.resources';
import { RESOURCE_ERROR_CODES } from '../../core/resources/types';
import {
  WIDGET_STATE_PROGRAM_ERROR_CODES,
  WidgetStateProgramError,
} from '../../core/widget-state/service.widget-state';
import { WIDGET_PROGRAM_ERROR_CODES, WidgetProgramError } from '../../core/widgets/service.widgets';
import { PrivateRpcError } from './rpc-contract';
import {
  isSemanticFailure,
  semanticFailureLogFields,
  semanticFailureStatus,
  semanticFailureToPrivateRpcError,
  type TSemanticFailure,
} from './semantic-failure';

const failures: readonly TSemanticFailure[] = [
  ...AGENT_PROGRAM_ERROR_CODES.map((code) => new AgentProgramError(code, code)),
  ...CANVAS_AUTHORITY_ERROR_CODES.map((code) => new CanvasAuthorityError(code, code)),
  ...DATABASE_PROGRAM_ERROR_CODES.map((code) => new DatabaseProgramError(code, code)),
  ...EVENT_PROGRAM_ERROR_CODES.map((code) => new EventProgramError(code, code)),
  ...FUNCTION_PROGRAM_ERROR_CODES.map((code) => new FunctionProgramError(code, code)),
  ...RESOURCE_ERROR_CODES.map((code) => new ResourceError(code, code)),
  ...RESOURCE_ERROR_CODES.map((code) => new ResourceProgramError(code, code)),
  ...WIDGET_STATE_PROGRAM_ERROR_CODES.map((code) => new WidgetStateProgramError(code, code)),
  ...WIDGET_PROGRAM_ERROR_CODES.map((code) => new WidgetProgramError(code, code)),
];

describe('semantic failure private RPC mapping', () => {
  test('maps every bounded code to one valid HTTP-like status and a decodable wire error', () => {
    for (const failure of failures) {
      expect(isSemanticFailure(failure)).toBe(true);
      expect([400, 403, 404, 409, 413, 429, 500, 503]).toContain(semanticFailureStatus(failure));
      const rpc = semanticFailureToPrivateRpcError(failure);
      const encoded = Schema.encodeSync(PrivateRpcError)(rpc);
      expect(Schema.decodeUnknownSync(PrivateRpcError)(encoded)).toEqual(rpc);
      expect(encoded).toMatchObject({
        _tag: 'PrivateRpcError',
        code: failure.code,
        status: semanticFailureStatus(failure),
        message: failure.message,
        details: {},
      });
    }
  });

  test('locks representative status decisions and preserves useful details', () => {
    const matrix = [
      [new AgentProgramError('CHAT_CANVAS_INVALID', 'invalid'), 400],
      [new CanvasAuthorityError('LIMIT_EXCEEDED', 'large'), 413],
      [new DatabaseProgramError('DATABASE_UNAVAILABLE', 'offline'), 503],
      [new EventProgramError('EVENT_CURSOR_INVALID', 'cursor'), 409],
      [new FunctionProgramError('RESOURCE_EXHAUSTED', 'full'), 429],
      [new ResourceError('DB_READ_NOT_ALLOWED', 'forbidden'), 403],
      [new ResourceProgramError('RESOURCE_NAME_CONFLICT', 'duplicate'), 409],
      [new WidgetStateProgramError('WIDGET_STATE_CAPACITY_UNAVAILABLE', 'full'), 429],
      [new WidgetProgramError('WIDGET_NOT_FOUND', 'missing', { widgetKey: 'counter' }), 404],
    ] as const;
    for (const [failure, status] of matrix) expect(semanticFailureStatus(failure)).toBe(status);

    const failure = matrix.at(-1)![0];
    expect(semanticFailureLogFields(failure)).toEqual({
      semanticFailureTag: 'WidgetProgramError',
      semanticFailureCode: 'WIDGET_NOT_FOUND',
      semanticFailureStatus: 404,
      semanticFailureDetails: { widgetKey: 'counter' },
    });
    expect(semanticFailureToPrivateRpcError(failure).details).toEqual({ widgetKey: 'counter' });
  });

  test('does not classify defects or interruption/cleanup causes as expected failures', () => {
    expect(isSemanticFailure(new Error('defect'))).toBe(false);
    expect(isSemanticFailure(new DOMException('cancelled', 'AbortError'))).toBe(false);
    expect(isSemanticFailure(Object.assign(new Error('cleanup'), { code: 'EIO' }))).toBe(false);
  });

  test('redacts sensitive resource details from both RPC and log projections', () => {
    const failure = new ResourceError('DB_QUERY_FAILED', 'Query failed.', {
      operation: 'list',
      sql: 'select secret from private_table',
      nested: { token: 'private', count: 2 },
    });
    expect(semanticFailureToPrivateRpcError(failure).details).toEqual({
      operation: 'list',
      nested: { count: 2 },
    });
    expect(semanticFailureLogFields(failure).semanticFailureDetails).toEqual({
      operation: 'list',
      nested: { count: 2 },
    });
  });
});
