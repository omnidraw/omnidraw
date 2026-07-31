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
import type { TResourceCall, TResourceCallResult } from '@omnidraw/resource-runtime';
import type { TWidgetServerFunctionDescriptor } from '@omnidraw/widget-contract';
import type { TFunctionFailure, TUsageMetrics } from '../types';
import { fnFunctionArtifactAdmission } from './fn.artifact-admission';
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

const ZERO_METRICS: TUsageMetrics = Object.freeze({
  activeWallMs: 0,
  cpuMs: 0,
  allocatedMemoryByteMs: 0,
  peakRssBytes: 0,
  diskReadBytes: 0,
  diskWriteBytes: 0,
  networkRxBytes: 0,
  networkTxBytes: 0,
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
  return { owner: 'user', code, message, retryable: false };
}

function platformFailure(code: string, message: string): TFunctionFailure {
  return { owner: 'platform', code, message, retryable: true };
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

async function importGuest(sourceBase64: string, expectedDigest: string): Promise<TGuestModule> {
  const source = Buffer.from(sourceBase64, 'base64');
  if (source.toString('base64') !== sourceBase64) throw new Error('Guest bundle is not canonical base64.');
  const digest = createHash('sha256').update(source).digest('hex');
  if (digest !== expectedDigest) throw new Error('Guest bundle digest does not match its artifact envelope.');
  const admission = fnFunctionArtifactAdmission(source.toString('utf8'));
  if (!admission.allowed) {
    throw new Error(`Guest bundle uses unsupported runtime construct '${admission.token}'.`);
  }
  const context = createContext(Object.create(null), {
    name: 'omnidraw-function-guest',
    codeGeneration: { strings: false, wasm: false },
  });
  const guestModule = new SourceTextModule(source.toString('utf8'), {
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

function resourceFacade(
  requestId: string,
  send: TSend,
  pending: Map<string, Readonly<{
    resolve(value: TResourceCallResult): void;
    reject(error: Error): void;
  }>>,
): Readonly<{
  read(slot: string, operation: string, input: unknown): Promise<unknown>;
  write(slot: string, operation: string, input: unknown): Promise<unknown>;
}> {
  let sequence = 0;
  const call = (resourceCall: TResourceCall): Promise<unknown> => {
    const callId = `${requestId}:${sequence++}`;
    return new Promise<TResourceCallResult>((resolve, reject) => {
      pending.set(callId, { resolve, reject });
      send({ type: 'resource_call', requestId, callId, call: resourceCall });
    }).then((result) => result.output);
  };
  return Object.freeze({
    read: (slot: string, operation: string, input: unknown) => call({
      slot,
      operation,
      effect: 'read',
      input,
    }),
    write: (slot: string, operation: string, input: unknown) => call({
      slot,
      operation,
      effect: 'write',
      input,
    }),
  });
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

function runtimeContext(
  guestContext: Context,
  value: TFunctionWorkerContext,
  requestId: string,
  send: TSend,
  pending: Map<string, Readonly<{
    resolve(value: TResourceCallResult): void;
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
  const resources = resourceFacade(requestId, send, pending);
  const bridge = Object.freeze({
    read: resources.read,
    write: resources.write,
    log: (level: 'debug' | 'info' | 'warn' | 'error', fields: Readonly<Record<string, unknown>>, message?: string) => (
      log(level)(fields, message)
    ),
  });
  const identity = JSON.stringify(value.identity);
  const invocationId = JSON.stringify(value.invocationId);
  const widgetRevisionId = JSON.stringify(value.widgetRevisionId);
  const subject = JSON.stringify(value.subject);
  const attemptId = JSON.stringify(value.attemptId);
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
      identity: Object.freeze(${identity}),
      invocationId: ${invocationId},
      widgetRevisionId: ${widgetRevisionId},
      subject: Object.freeze(${subject}),
      attemptId: ${attemptId},
      leaseEpoch: ${value.leaseEpoch},
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
    resolve(value: TResourceCallResult): void;
    reject(error: Error): void;
  }>>();

  process.on('message', (raw: unknown) => {
    const message = raw as THostToFunctionWorkerMessage;
    if (message.type === 'inspect') {
      void importGuest(message.sourceBase64, message.sourceDigestSha256)
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
      void importGuest(message.sourceBase64, message.sourceDigestSha256)
        .then((guestModule) => {
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
      const pending = pendingResources.get(message.callId);
      if (!pending) return;
      pendingResources.delete(message.callId);
      if (message.error) {
        pending.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
      } else if (message.result) {
        pending.resolve(message.result);
      } else {
        pending.reject(new Error('Resource host returned an invalid result.'));
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
          ? { owner: 'cancelled', code: 'FUNCTION_CANCELLED', message: 'Function invocation was cancelled.', retryable: false }
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
      for (const [callId, pending] of pendingResources) {
        pending.reject(new Error('Function execution ended before its resource call completed.'));
        pendingResources.delete(callId);
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
