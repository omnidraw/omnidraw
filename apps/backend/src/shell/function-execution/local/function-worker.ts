/**
 * @file Single-invocation Bun child. Guest modules run in a blank node:vm
 * context with imports and generated code disabled. This is defense in depth
 * for the OSS development/test adapter, not a hostile-code production boundary.
 */

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  createContext,
  runInContext,
  SourceTextModule,
  type Context,
} from 'node:vm';
import {
  PORTABLE_RESOURCE_DB_EXECUTE_FORMAT,
  PORTABLE_RESOURCE_DB_ROWS_FORMAT,
  PortableResourceWireError,
  fnDecodePortableResourceDbExecute,
  fnDecodePortableResourceDbRows,
  fnDecodePortableResourceResponse,
  fnEncodePortableResourceValue,
  fnEncodePortableResourceRequest,
  fnWidgetServerModulePolicyAdmission,
  type TWidgetServerFunctionDescriptor,
} from '@omnidraw/sdk/contract';
import type { TFunctionFailure, TFunctionUsageMetrics } from '../types';
import type {
  TFunctionCanonicalRegistration,
  TFunctionWorkerContext,
  TFunctionWorkerToHostMessage,
  THostToFunctionWorkerMessage,
} from './worker-types';

type TGuestFunction = Readonly<{
  __omnidrawServerFunction: 'omnidraw.server-function.v1';
  __omnidrawRegistration: TFunctionCanonicalRegistration;
  __omnidrawExecute(context: unknown, input: unknown): Promise<unknown>;
}>;

type TGuestModule = Readonly<{
  context: Context;
  namespace: Record<string, unknown>;
}>;

type TLoadedGuest = Readonly<{
  context: Context;
  value: TGuestFunction;
}>;

type TSend = (message: TFunctionWorkerToHostMessage) => void;

const ZERO_METRICS: TFunctionUsageMetrics = Object.freeze({
  activeWallMs: 0,
  cpuMs: 0,
  allocatedMemoryByteMs: 0,
  peakRssBytes: 0,
});

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
    .join(',')}}`;
}

function userFailure(code: string, message: string): TFunctionFailure {
  return { owner: 'user', code, message };
}

function platformFailure(code: string, message: string): TFunctionFailure {
  return { owner: 'platform', code, message };
}

function guestFunction(value: unknown): value is TGuestFunction {
  if ((typeof value !== 'function' && (value === null || typeof value !== 'object'))) return false;
  const record = value as Record<string, unknown>;
  const marker = Object.getOwnPropertyDescriptor(record, '__omnidrawServerFunction');
  const registration = Object.getOwnPropertyDescriptor(record, '__omnidrawRegistration');
  const execute = Object.getOwnPropertyDescriptor(record, '__omnidrawExecute');
  return marker?.get === undefined
    && marker?.value === 'omnidraw.server-function.v1'
    && registration?.get === undefined
    && registration?.value !== null
    && typeof registration?.value === 'object'
    && execute?.get === undefined
    && typeof execute?.value === 'function';
}

async function importGuest(moduleBytes: Uint8Array, expectedDigest: string): Promise<TGuestModule> {
  if (!(moduleBytes instanceof Uint8Array) || moduleBytes.byteLength === 0) {
    throw new Error('Guest module bytes are invalid.');
  }
  const source = new Uint8Array(moduleBytes);
  const digest = createHash('sha256').update(source).digest('hex');
  if (digest !== expectedDigest) throw new Error('Guest module digest does not match its pinned artifact.');
  const admission = fnWidgetServerModulePolicyAdmission({
    phase: 'closed_bundle',
    source: Buffer.from(source).toString('utf8'),
  });
  if (!admission.allowed) {
    throw new Error(`Guest bundle uses unsupported runtime construct '${admission.token}'.`);
  }
  const context = createContext(Object.create(null), {
    name: 'omnidraw-function-guest',
    codeGeneration: { strings: false, wasm: false },
  });
  const guestModule = new SourceTextModule(Buffer.from(source).toString('utf8'), {
    context,
    identifier: 'omnidraw:function-guest',
    importModuleDynamically: async () => {
      throw new Error('Function guest dynamic imports are unavailable.');
    },
  });
  await guestModule.link(async () => {
    throw new Error('Function guest module imports are unavailable.');
  });
  await guestModule.evaluate();
  return Object.freeze({
    context,
    namespace: guestModule.namespace as unknown as Record<string, unknown>,
  });
}

function registrationDescriptors(namespace: Record<string, unknown>): readonly TWidgetServerFunctionDescriptor[] {
  const descriptors: TWidgetServerFunctionDescriptor[] = [];
  for (const exportName of Object.keys(namespace).sort()) {
    const value = namespace[exportName];
    if (!guestFunction(value)) {
      throw new Error(`Server artifact export '${exportName}' is not a defined server function.`);
    }
    descriptors.push(Object.freeze({
      ...(value.__omnidrawRegistration as TFunctionCanonicalRegistration),
      exportName,
    }));
  }
  if (descriptors.length === 0) throw new Error('Server artifact exposes no registered server functions.');
  return Object.freeze(descriptors);
}

function boundedJsonBytes(value: unknown): number {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new Error('Function value is not JSON serializable.');
  }
  if (text === undefined) throw new Error('Function value is not JSON serializable.');
  return Buffer.byteLength(text, 'utf8');
}

/** Normalize guest-realm data before applying the host-owned portable codec. */
function hostPortableValue(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    throw new Error('Resource request is not structured-cloneable.');
  }
}

function resourceFacade(
  guestContext: Context,
  requestId: string,
  send: TSend,
  pending: Map<string, Readonly<{
    operation: string;
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>>,
): Readonly<{
  read(slot: string, operation: string, input: unknown): Promise<unknown>;
  write(slot: string, operation: string, input: unknown): Promise<unknown>;
}> {
  let sequence = 0;
  const call = (
    effect: 'read' | 'write',
    slot: string,
    operation: string,
    input: unknown,
  ): Promise<unknown> => {
    const correlationId = `${requestId}:${sequence++}`;
    let request: ReturnType<typeof fnEncodePortableResourceRequest>;
    try {
      request = fnEncodePortableResourceRequest({
        correlationId,
        slot,
        operation,
        effect,
        input: hostPortableValue(input),
      });
    } catch (error) {
      const overLimit = error instanceof PortableResourceWireError
        && error.code === 'LIMIT_EXCEEDED';
      return Promise.reject(guestCodedError(
        guestContext,
        overLimit
          ? 'Resource operation exceeded a limit.'
          : 'Resource request is malformed.',
        overLimit ? 'RESOURCE_LIMIT_EXCEEDED' : 'RESOURCE_MALFORMED_INPUT',
      ));
    }
    return new Promise<unknown>((resolve, reject) => {
      pending.set(correlationId, { operation, resolve, reject });
      send({ type: 'resource_call', requestId, request });
    });
  };
  return Object.freeze({
    read: (slot: string, operation: string, input: unknown) => (
      call('read', slot, operation, input)
    ),
    write: (slot: string, operation: string, input: unknown) => (
      call('write', slot, operation, input)
    ),
  });
}

function resourceWireFormat(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, 'format');
  return descriptor?.get === undefined ? descriptor?.value : undefined;
}

export function fnDecodeFunctionWorkerResourceOutput(
  operation: string,
  output: unknown,
): unknown {
  if (operation === 'query') return fnDecodePortableResourceDbRows(output);
  if (operation === 'execute') {
    return Array.isArray(output)
      ? Object.freeze(output.map((item) => fnDecodePortableResourceDbExecute(item)))
      : fnDecodePortableResourceDbExecute(output);
  }
  if (operation !== 'invoke') return output;
  const format = resourceWireFormat(output);
  if (format === PORTABLE_RESOURCE_DB_ROWS_FORMAT) {
    return fnDecodePortableResourceDbRows(output);
  }
  if (format === PORTABLE_RESOURCE_DB_EXECUTE_FORMAT) {
    return fnDecodePortableResourceDbExecute(output);
  }
  if (Array.isArray(output)) {
    return Object.freeze(output.map((item) => fnDecodePortableResourceDbExecute(item)));
  }
  throw new Error('Resource host returned an invalid database result.');
}

export function fnMaterializeFunctionWorkerResourceOutput(
  guestContext: Context,
  operation: string,
  output: unknown,
): unknown {
  return guestPortableValue(
    guestContext,
    fnDecodeFunctionWorkerResourceOutput(operation, output),
  );
}

function resourceResponseCorrelationId(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, 'correlationId');
  return descriptor?.get === undefined && typeof descriptor?.value === 'string'
    ? descriptor.value
    : null;
}

function withGuestBinding<T>(
  context: Context,
  name: string,
  value: unknown,
  source: string,
): T {
  Object.defineProperty(context, name, {
    configurable: true,
    enumerable: false,
    writable: false,
    value,
  });
  try {
    return runInContext(source, context) as T;
  } finally {
    delete (context as Record<string, unknown>)[name];
  }
}

function guestJsonValue(context: Context, value: unknown): unknown {
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error('Function input is not JSON serializable.');
  return withGuestBinding(
    context,
    '__omnidrawHostJson',
    text,
    'JSON.parse(__omnidrawHostJson)',
  );
}

function guestPortableValue(context: Context, value: unknown): unknown {
  const text = JSON.stringify(fnEncodePortableResourceValue(value));
  return withGuestBinding(context, '__omnidrawHostPortableValue', text, `(() => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const decodeBase64 = (value) => {
      const bytes = [];
      let bits = 0;
      let bitCount = 0;
      for (const character of value.replace(/=+$/, '')) {
        bits = (bits << 6) | alphabet.indexOf(character);
        bitCount += 6;
        if (bitCount >= 8) {
          bitCount -= 8;
          bytes.push((bits >> bitCount) & 255);
        }
      }
      return Uint8Array.from(bytes);
    };
    const decode = (node) => {
      if (node.type === 'null') return null;
      if (node.type === 'boolean' || node.type === 'number' || node.type === 'string') {
        return node.value;
      }
      if (node.type === 'bigint') return BigInt(node.value);
      if (node.type === 'bytes') return decodeBase64(node.base64);
      if (node.type === 'array') return node.items.map(decode);
      const value = Object.create(null);
      for (const [key, item] of node.entries) value[key] = decode(item);
      return value;
    };
    return decode(JSON.parse(__omnidrawHostPortableValue));
  })()`);
}

function guestCodedError(context: Context, message: string, code?: string): Error {
  return withGuestBinding(context, '__omnidrawHostError', { message, code }, `(() => {
    const error = new Error(__omnidrawHostError.message);
    if (__omnidrawHostError.code !== undefined) {
      Object.defineProperty(error, 'code', {
        enumerable: true,
        value: __omnidrawHostError.code,
      });
    }
    return error;
  })()`);
}

export function fnMaterializeFunctionWorkerError(
  guestContext: Context,
  message: string,
  code?: string,
): Error {
  return guestCodedError(guestContext, message, code);
}

function runtimeContext(
  guestContext: Context,
  value: TFunctionWorkerContext,
  requestId: string,
  send: TSend,
  pending: Map<string, Readonly<{
    operation: string;
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>>,
): Readonly<{
  value: unknown;
  abort(reason: string): void;
  isAborted(): boolean;
}> {
  const log = (level: 'debug' | 'info' | 'warn' | 'error') => (
    fields: Readonly<Record<string, unknown>>,
    message?: string,
  ) => {
    const values = message === undefined ? [fields] : [fields, message];
    send({ type: 'log', requestId, level, values, byteSize: boundedJsonBytes(values) });
  };
  const resources = resourceFacade(guestContext, requestId, send, pending);
  const bridge = Object.freeze({
    read: resources.read,
    write: resources.write,
    log: (level: 'debug' | 'info' | 'warn' | 'error', fields: Readonly<Record<string, unknown>>, message?: string) => (
      log(level)(fields, message)
    ),
  });
  const invocationId = JSON.stringify(value.invocationId);
  const widgetKey = JSON.stringify(value.widgetKey);
  const subject = JSON.stringify(value.subject);
  return withGuestBinding(guestContext, '__omnidrawHostBridge', bridge, `(() => {
    const bridge = __omnidrawHostBridge;
    let aborted = false;
    let abortReason;
    const listeners = new Set();
    let signal;
    signal = Object.freeze({
      get aborted() { return aborted; },
      get reason() { return abortReason; },
      addEventListener(type, listener) {
        if (type !== 'abort' || typeof listener !== 'function') return;
        if (aborted) listener.call(undefined, Object.freeze({ type: 'abort', target: signal }));
        else listeners.add(listener);
      },
      removeEventListener(type, listener) {
        if (type === 'abort') listeners.delete(listener);
      },
      throwIfAborted() {
        if (aborted) throw new Error(String(abortReason ?? 'Function invocation was cancelled.'));
      },
    });
    const abort = (reason) => {
      if (aborted) return;
      aborted = true;
      abortReason = reason;
      const event = Object.freeze({ type: 'abort', target: signal });
      for (const listener of listeners) listener.call(undefined, event);
      listeners.clear();
    };
    const runtime = Object.freeze({
      invocationId: ${invocationId},
      widgetKey: ${widgetKey},
      subject: Object.freeze(${subject}),
      deadlineAtMs: ${value.deadlineAtMs},
      signal,
      resources: Object.freeze({
        read: (slot, operation, input) => bridge.read(slot, operation, input),
        write: (slot, operation, input) => bridge.write(slot, operation, input),
      }),
      log: Object.freeze({
        debug: (fields, message) => bridge.log('debug', fields, message),
        info: (fields, message) => bridge.log('info', fields, message),
        warn: (fields, message) => bridge.log('warn', fields, message),
        error: (fields, message) => bridge.log('error', fields, message),
      }),
      metrics: Object.freeze({ increment: () => undefined }),
    });
    return Object.freeze({ value: runtime, abort, isAborted: () => aborted });
  })()`);
}

export function runFunctionWorker(): void {
  if (typeof process.send !== 'function') {
    throw new Error('Function worker requires a host-owned Bun IPC channel.');
  }
  const send: TSend = (message) => process.send!(message);
  Object.defineProperty(globalThis, 'fetch', {
    configurable: false,
    writable: false,
    value: async () => {
      throw new Error('Network access is unavailable in server functions.');
    },
  });
  let loaded: TLoadedGuest | null = null;
  let active: Readonly<{ requestId: string; abort(reason: string): void }> | null = null;
  const pendingResources = new Map<string, Readonly<{
    operation: string;
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>>();

  process.on('message', (raw: unknown) => {
    const message = raw as THostToFunctionWorkerMessage;
    if (message.type === 'inspect') {
      void importGuest(message.moduleBytes, message.moduleDigestSha256)
        .then((guestModule) => send({
          type: 'inspected',
          requestId: message.requestId,
          descriptors: registrationDescriptors(guestModule.namespace),
        }))
        .catch((error) => send({
          type: 'load_error',
          requestId: message.requestId,
          failure: userFailure('FUNCTION_REGISTRATION_INVALID', String(error)),
        }));
      return;
    }
    if (message.type === 'load') {
      void importGuest(message.moduleBytes, message.moduleDigestSha256)
        .then((guestModule) => {
          const actualDescriptors = registrationDescriptors(guestModule.namespace);
          if (canonical(actualDescriptors) !== canonical(message.functionDescriptors)) {
            throw new Error('Canonical server module descriptors do not match publication metadata.');
          }
          const selected = guestModule.namespace[message.exportName];
          if (!guestFunction(selected)) {
            throw new Error(`Canonical function export '${message.exportName}' is missing or invalid.`);
          }
          if (canonical(selected.__omnidrawRegistration) !== canonical(message.canonicalRegistration)) {
            throw new Error(`Canonical function export '${message.exportName}' registration does not match publication metadata.`);
          }
          loaded = { context: guestModule.context, value: selected };
          send({ type: 'loaded', requestId: message.requestId });
        })
        .catch((error) => send({
          type: 'load_error',
          requestId: message.requestId,
          failure: platformFailure('FUNCTION_ARTIFACT_INVALID', String(error)),
        }));
      return;
    }
    if (message.type === 'resource_result') {
      const correlationId = resourceResponseCorrelationId(message.response);
      if (correlationId === null) {
        for (const pending of pendingResources.values()) {
          pending.reject(loaded === null
            ? new Error('Resource host returned an invalid result.')
            : guestCodedError(loaded.context, 'Resource host returned an invalid result.'));
        }
        pendingResources.clear();
        return;
      }
      const pending = pendingResources.get(correlationId);
      if (!pending) return;
      pendingResources.delete(correlationId);
      try {
        const response = fnDecodePortableResourceResponse(message.response);
        if ('failure' in response) {
          if (loaded === null) throw new Error('Function guest is not loaded.');
          pending.reject(guestCodedError(
            loaded.context,
            response.failure.message,
            response.failure.code,
          ));
        } else {
          if (loaded === null) throw new Error('Function guest is not loaded.');
          pending.resolve(fnMaterializeFunctionWorkerResourceOutput(
            loaded.context,
            pending.operation,
            response.output,
          ));
        }
      } catch {
        pending.reject(loaded === null
          ? new Error('Resource host returned an invalid result.')
          : guestCodedError(loaded.context, 'Resource host returned an invalid result.'));
      }
      return;
    }
    if (message.type === 'cancel') {
      if (active?.requestId === message.requestId) active.abort(message.reason);
      return;
    }
    if (message.type !== 'execute') return;
    if (loaded === null || active !== null) {
      send({
        type: 'failure',
        requestId: message.requestId,
        failure: platformFailure('FUNCTION_WORKER_STATE_INVALID', 'Function worker is not ready for execution.'),
        metrics: ZERO_METRICS,
      });
      return;
    }
    const guestRuntime = runtimeContext(
      loaded.context,
      message.context,
      message.requestId,
      send,
      pendingResources,
    );
    active = { requestId: message.requestId, abort: guestRuntime.abort };
    const startedAt = performance.now();
    const cpuStarted = process.cpuUsage();
    let execution: Promise<unknown>;
    try {
      execution = Promise.resolve(loaded.value.__omnidrawExecute(
        guestRuntime.value,
        guestJsonValue(loaded.context, message.input),
      ));
    } catch (error) {
      execution = Promise.reject(error);
    }
    void execution.then((output) => {
      const outputByteSize = boundedJsonBytes(output);
      const cpu = process.cpuUsage(cpuStarted);
      const rss = process.memoryUsage().rss;
      send({
        type: 'result',
        requestId: message.requestId,
        output,
        outputByteSize,
        metrics: {
          ...ZERO_METRICS,
          activeWallMs: Math.max(0, performance.now() - startedAt),
          cpuMs: (cpu.user + cpu.system) / 1_000,
          peakRssBytes: rss,
        },
      });
    }).catch((error) => {
      const cpu = process.cpuUsage(cpuStarted);
      const cancelled = guestRuntime.isAborted();
      send({
        type: 'failure',
        requestId: message.requestId,
        failure: cancelled
          ? { owner: 'cancelled', code: 'FUNCTION_CANCELLED', message: 'Function invocation was cancelled.' }
          : userFailure('FUNCTION_HANDLER_FAILED', error instanceof Error ? error.message : 'Function handler failed.'),
        metrics: {
          ...ZERO_METRICS,
          activeWallMs: Math.max(0, performance.now() - startedAt),
          cpuMs: (cpu.user + cpu.system) / 1_000,
          peakRssBytes: process.memoryUsage().rss,
        },
      });
    }).finally(() => {
      active = null;
      for (const [correlationId, pending] of pendingResources) {
        pending.reject(loaded === null
          ? new Error('Function execution ended before its resource call completed.')
          : guestCodedError(
              loaded.context,
              'Function execution ended before its resource call completed.',
            ));
        pendingResources.delete(correlationId);
      }
    });
  });
  const memoryStarted = process.cpuUsage();
  const memoryTimer = setInterval(() => {
    const cpu = process.cpuUsage(memoryStarted);
    send({
      type: 'memory',
      rssBytes: process.memoryUsage().rss,
      cpuMs: (cpu.user + cpu.system) / 1_000,
    });
  }, 50);
  (memoryTimer as unknown as { unref?: () => void }).unref?.();
  send({ type: 'ready' });
}

if (import.meta.main) runFunctionWorker();
