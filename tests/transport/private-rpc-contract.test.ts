import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { Schema } from 'effect'
import {
  PrivateRequestRpc as BackendPrivateRequestRpc,
  PrivateRpcError as BackendPrivateRpcError,
  PrivateStreamRpc as BackendPrivateStreamRpc,
} from '../../apps/backend/src/shell/transport/rpc-contract'
import {
  PRIVATE_REQUEST_PATHS as BACKEND_REQUEST_PATHS,
  PRIVATE_STREAM_PATHS as BACKEND_STREAM_PATHS,
  PRIVATE_OPERATION_CONTRACTS,
} from '../../apps/backend/src/shell/transport/operation-contract'
import { PrivateRpcError as FrontendPrivateRpcError } from '../../apps/frontend/src/core/app/private-rpc-error'
import {
  PRIVATE_REQUEST_PATHS as FRONTEND_REQUEST_PATHS,
  PRIVATE_STREAM_PATHS as FRONTEND_STREAM_PATHS,
} from '../../apps/frontend/src/core/app/private-operation-contract'
import {
  PrivateRequestRpc as FrontendPrivateRequestRpc,
  PrivateStreamRpc as FrontendPrivateStreamRpc,
} from '../../apps/frontend/src/shell/transport/rpc'

const backendErrorCodec = Schema.toCodecJson(BackendPrivateRpcError)
const frontendErrorCodec = Schema.toCodecJson(FrontendPrivateRpcError)
const backendPayloadCodec = Schema.toCodecJson(BackendPrivateRequestRpc.payloadSchema)
const frontendPayloadCodec = Schema.toCodecJson(FrontendPrivateRequestRpc.payloadSchema)
const backendStreamPayloadCodec = Schema.toCodecJson(BackendPrivateStreamRpc.payloadSchema)
const frontendStreamPayloadCodec = Schema.toCodecJson(FrontendPrivateStreamRpc.payloadSchema)

const failure = Object.freeze({
  _tag: 'PrivateRpcError' as const,
  code: 'CHAT_SCOPE_INVALID',
  status: 404,
  message: 'The AI Chat element is not present on the requested canvas.',
  details: { canvasId: 'canvas-1', widgetId: 'widget-1' },
})

describe('private Effect RPC client/server contract parity', () => {
  test('keeps the complete finite request and stream inventories identical', () => {
    expect(FRONTEND_REQUEST_PATHS).toEqual(BACKEND_REQUEST_PATHS)
    expect(FRONTEND_STREAM_PATHS).toEqual(BACKEND_STREAM_PATHS)
    expect(new Set(BACKEND_REQUEST_PATHS).size).toBe(BACKEND_REQUEST_PATHS.length)
    expect(new Set(BACKEND_STREAM_PATHS).size).toBe(BACKEND_STREAM_PATHS.length)
  })

  test('attaches one correctly classified payload and output codec to every operation', () => {
    const requestPaths = new Set<string>(BACKEND_REQUEST_PATHS)
    const streamPaths = new Set<string>(BACKEND_STREAM_PATHS)
    const noInputPaths = new Set([
      'agent.settings.get',
      'canvas.list',
      'widget.catalog.get',
      'widget.runtime.config',
    ])

    expect([...requestPaths].filter((path) => streamPaths.has(path))).toEqual([])
    expect(PRIVATE_OPERATION_CONTRACTS.size).toBe(requestPaths.size + streamPaths.size)
    for (const [path, operation] of PRIVATE_OPERATION_CONTRACTS) {
      expect(operation.path).toBe(path)
      expect(operation.stream).toBe(streamPaths.has(path))
      expect(operation.procedure.contract.streamOutput).toBe(operation.stream)
      expect(operation.procedure.contract.outputSchema).toBeDefined()
      expect(operation.procedure.contract.inputSchema === undefined).toBe(noInputPaths.has(path))
    }
  })

  test('cross-decodes typed backend and frontend failures without Never drift', () => {
    const encodedByBackend = Schema.encodeUnknownSync(backendErrorCodec)(
      new BackendPrivateRpcError(failure),
    )
    const decodedByFrontend = Schema.decodeUnknownSync(frontendErrorCodec)(encodedByBackend)
    expect(decodedByFrontend).toMatchObject(failure)

    const encodedByFrontend = Schema.encodeUnknownSync(frontendErrorCodec)(
      new FrontendPrivateRpcError(failure),
    )
    const decodedByBackend = Schema.decodeUnknownSync(backendErrorCodec)(encodedByFrontend)
    expect(decodedByBackend).toMatchObject(failure)
  })

  test('rejects non-JSON failure details at both error boundaries', () => {
    const invalid = {
      ...failure,
      details: { attemptedAt: new Date('2026-08-13T00:00:00.000Z') },
    }
    expect(() => Schema.encodeUnknownSync(backendErrorCodec)(
      new BackendPrivateRpcError(invalid),
    )).toThrow()
    expect(() => Schema.encodeUnknownSync(frontendErrorCodec)(
      new FrontendPrivateRpcError(invalid),
    )).toThrow()
  })

  test('cross-decodes the complete request envelope in both directions', () => {
    const request = Object.freeze({
      path: 'agent.chat.connect',
      input: {
        canvasId: 'canvas-1',
        widgetId: 'widget-1',
        sessionId: 'session-1',
        mode: 'reuse',
      },
      idempotencyKey: 'stable-key-1',
    })
    const backendEncoded = Schema.encodeUnknownSync(backendPayloadCodec)(request)
    const frontendEncoded = Schema.encodeUnknownSync(frontendPayloadCodec)(request)
    expect(Schema.decodeUnknownSync(frontendPayloadCodec)(backendEncoded)).toEqual(request)
    expect(Schema.decodeUnknownSync(backendPayloadCodec)(frontendEncoded)).toEqual(request)
  })

  test('cross-decodes the complete resumable stream envelope in both directions', () => {
    const request = Object.freeze({
      path: 'agent.events',
      input: { widgetId: 'widget-1', sessionId: 'session-1' },
      afterCursor: 17,
    })
    const backendEncoded = Schema.encodeUnknownSync(backendStreamPayloadCodec)(request)
    const frontendEncoded = Schema.encodeUnknownSync(frontendStreamPayloadCodec)(request)
    expect(Schema.decodeUnknownSync(frontendStreamPayloadCodec)(backendEncoded)).toEqual(request)
    expect(Schema.decodeUnknownSync(backendStreamPayloadCodec)(frontendEncoded)).toEqual(request)
  })

  test('rejects every non-JSON request vector at both wire boundaries', () => {
    const sparse = new Array(2)
    sparse[1] = 'present'
    const invalidInputs: readonly unknown[] = [
      { sessionId: 'session-1', model: undefined },
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
      { value: Number.NEGATIVE_INFINITY },
      { values: sparse },
      { value: 1n },
      { value: Symbol('not-json') },
      { value: new Date('2026-08-13T00:00:00.000Z') },
      { value: new Map([['key', 'value']]) },
    ]
    for (const input of invalidInputs) {
      const invalid = { path: 'agent.chat.prompt', input }
      expect(() => Schema.encodeUnknownSync(backendPayloadCodec)(invalid)).toThrow('Expected JSON value')
      expect(() => Schema.encodeUnknownSync(frontendPayloadCodec)(invalid)).toThrow('Expected JSON value')
      const invalidStream = { path: 'agent.events', input }
      expect(() => Schema.encodeUnknownSync(backendStreamPayloadCodec)(invalidStream)).toThrow('Expected JSON value')
      expect(() => Schema.encodeUnknownSync(frontendStreamPayloadCodec)(invalidStream)).toThrow('Expected JSON value')
    }
  })

  test('preserves valid omitted optionals instead of projecting undefined', () => {
    const prompt = {
      path: 'agent.chat.prompt',
      input: {
        canvasId: 'canvas-1',
        widgetId: 'widget-1',
        sessionId: 'session-1',
        message: 'hello',
      },
    }
    const encodedByBackend = Schema.encodeUnknownSync(backendPayloadCodec)(prompt)
    const encodedByFrontend = Schema.encodeUnknownSync(frontendPayloadCodec)(prompt)
    expect(encodedByBackend).toEqual(prompt)
    expect(encodedByFrontend).toEqual(prompt)
    expect(JSON.stringify(encodedByBackend)).not.toContain('undefined')
  })

  test('frontend feature consumers cannot override a result type independently of the operation path', async () => {
    const roots = [
      'apps/frontend/src/core',
      'apps/frontend/src/shell/browser',
      'apps/frontend/src/shell/canvas',
      'apps/frontend/src/shell/chat',
      'apps/frontend/src/shell/framework',
      'apps/frontend/src/shell/widgets',
    ]
    const files: string[] = []
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name)
        if (entry.isDirectory()) await visit(absolute)
        else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(absolute)
      }
    }
    await Promise.all(roots.map(visit))
    const violations: string[] = []
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      if (/\.(?:safeRequest|safeStream|request|stream)\s*</.test(source)) violations.push(file)
    }
    expect(violations).toEqual([])
  })
})
