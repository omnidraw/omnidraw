import { implement, onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/bun-ws';
import { apiContract } from '@omnidraw/api/contract';
import type { TApiContext } from '@omnidraw/api/context';
import { router } from '@omnidraw/api/router';
import { AgentService } from '@omnidraw/service-agent';
import {
  fnToolError,
  fnToolSuccessWithPng,
} from '@omnidraw/service-agent/tools/fn.result';
import { EventPublisherService } from '@omnidraw/service-event-publisher/EventPublisherService';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SYNTHETIC_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4nGP4z8DwHwwZGP6DAQBJyAn3FGMynQAAAABJRU5ErkJggg==';
const SYNTHETIC_TOOL_NAME = 'synthetic_image_transport_proof';
const SYNTHETIC_PROVIDER = 'synthetic-image-provider';
const SYNTHETIC_MODEL = 'synthetic-image-model';
let syntheticToolCallSequence = 0;
const requestedPort = Number(process.env.OMNIDRAW_AGENT_IMAGE_TEST_PORT);
if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65_535) {
  throw new Error('OMNIDRAW_AGENT_IMAGE_TEST_PORT must be a valid non-privileged port.');
}

type TAssistantMessage = Readonly<{
  role: 'assistant';
  content: readonly unknown[];
  api: string;
  provider: string;
  model: string;
  usage: Readonly<{
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: Readonly<{
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    }>;
  }>;
  stopReason: 'aborted' | 'stop' | 'toolUse';
  errorMessage?: string;
  timestamp: number;
}>;

type TProviderContext = Readonly<{
  messages: readonly Array<Readonly<{
    role?: string;
    content?: unknown;
    details?: unknown;
  }>>;
}>;

type TProviderOptions = Readonly<{ signal?: AbortSignal }>;

type TMutableAgentSession = Readonly<{
  _allowedToolNames?: Set<string>;
  _customTools: unknown[];
  _refreshToolRegistry(): void;
  getToolDefinition(name: string): unknown;
}>;

type TChatRecord = Readonly<{
  id: string;
  canvasId: string | null;
  name: string;
  status: 'active' | 'archived' | 'error';
  workspaceRelativePath: string;
  historyRelativePath: string;
}>;

function createUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function createAssistantMessage(
  content: readonly unknown[],
  stopReason: TAssistantMessage['stopReason'],
  errorMessage?: string,
): TAssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'synthetic-image-api',
    provider: SYNTHETIC_PROVIDER,
    model: SYNTHETIC_MODEL,
    usage: createUsage(),
    stopReason,
    ...(errorMessage === undefined ? {} : { errorMessage }),
    timestamp: Date.now(),
  };
}

function createCompletedStream(message: TAssistantMessage, delayMs = 0) {
  return {
    async *[Symbol.asyncIterator]() {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      yield { type: 'start', partial: message };
      const toolCall = message.content.find((part) => (
        typeof part === 'object'
        && part !== null
        && 'type' in part
        && part.type === 'toolCall'
      ));
      if (toolCall) {
        yield { type: 'toolcall_start', contentIndex: 0, partial: message };
        yield { type: 'toolcall_end', contentIndex: 0, toolCall, partial: message };
      } else if (message.content.length > 0) {
        yield { type: 'text_start', contentIndex: 0, partial: message };
        yield {
          type: 'text_end',
          contentIndex: 0,
          content: (message.content[0] as { text?: string }).text ?? '',
          partial: message,
        };
      }
      yield { type: 'done', reason: message.stopReason, message };
    },
    async result() {
      return message;
    },
  };
}

function createCanceledStream(options?: TProviderOptions) {
  const started = createAssistantMessage([{
    type: 'text',
    text: 'Synthetic response is waiting for cancellation.',
  }], 'stop');
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'start', partial: started };
      yield { type: 'text_start', contentIndex: 0, partial: started };
      yield {
        type: 'text_end',
        contentIndex: 0,
        content: 'Synthetic response is waiting for cancellation.',
        partial: started,
      };
      await new Promise<void>((resolve) => {
        if (options?.signal?.aborted) {
          resolve();
          return;
        }
        options?.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      const aborted = createAssistantMessage([], 'aborted', 'Synthetic response was canceled.');
      yield { type: 'error', reason: 'aborted', error: aborted };
    },
    async result() {
      return createAssistantMessage([], 'aborted', 'Synthetic response was canceled.');
    },
  };
}

function textContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap((part) => (
    typeof part === 'object'
    && part !== null
    && 'type' in part
    && part.type === 'text'
    && 'text' in part
    && typeof part.text === 'string'
      ? [part.text]
      : []
  )).join('');
}

function latestUserText(context: TProviderContext): string {
  const latest = [...context.messages].reverse().find((message) => message.role === 'user');
  return textContent(latest?.content);
}

function latestToolResult(context: TProviderContext) {
  return [...context.messages].reverse().find((message) => message.role === 'toolResult');
}

function createSyntheticProviderStream(
  _model: unknown,
  context: TProviderContext,
  options?: TProviderOptions,
) {
  const prompt = latestUserText(context).toLowerCase();
  if (prompt.includes('cancel')) return createCanceledStream(options);

  const toolResult = latestToolResult(context);
  const latestUserIndex = context.messages.findLastIndex((message) => message.role === 'user');
  const latestToolIndex = context.messages.findLastIndex((message) => message.role === 'toolResult');
  if (!toolResult || latestToolIndex < latestUserIndex) {
    const outcome = prompt.includes('failure') ? 'failure' : 'success';
    return createCompletedStream(createAssistantMessage([{
      type: 'toolCall',
      id: `synthetic-tool-${++syntheticToolCallSequence}`,
      name: SYNTHETIC_TOOL_NAME,
      arguments: { outcome },
    }], 'toolUse'));
  }

  const content = Array.isArray(toolResult.content) ? toolResult.content : [];
  const images = content.filter((part) => (
    typeof part === 'object'
    && part !== null
    && 'type' in part
    && part.type === 'image'
  ));
  const textualContent = content.map((part) => textContent([part])).join('');
  const serializedDetails = JSON.stringify(toolResult.details ?? {});
  if (textualContent.includes(SYNTHETIC_PNG_BASE64) || serializedDetails.includes(SYNTHETIC_PNG_BASE64)) {
    throw new Error('Synthetic PNG data escaped its typed image content block.');
  }

  if (prompt.includes('failure')) {
    if (images.length !== 0) throw new Error('Failed image tool result unexpectedly contained an image.');
    return createCompletedStream(createAssistantMessage([{
      type: 'text',
      text: 'Model received the image-tool failure without an image.',
    }], 'stop'));
  }

  if (images.length !== 1) throw new Error('The next model turn did not receive exactly one image.');
  const image = images[0] as { mimeType?: unknown; data?: unknown };
  if (image.mimeType !== 'image/png' || image.data !== SYNTHETIC_PNG_BASE64) {
    throw new Error('The next model turn received a changed PNG image block.');
  }
  return createCompletedStream(createAssistantMessage([{
    type: 'text',
    text: 'Model next turn received the PNG image safely.',
  }], 'stop'), 200);
}

function createSyntheticTool() {
  return {
    name: SYNTHETIC_TOOL_NAME,
    label: 'Synthetic Image Transport Proof',
    description: 'Test-only image transport fixture.',
    parameters: {
      type: 'object',
      properties: {
        outcome: { type: 'string', enum: ['success', 'failure'] },
      },
      required: ['outcome'],
      additionalProperties: false,
    },
    async execute(_toolCallId: string, params: { outcome: 'failure' | 'success' }) {
      if (params.outcome === 'failure') {
        return fnToolError({
          code: 'SYNTHETIC_IMAGE_FAILURE',
          message: 'Synthetic image transport failure.',
          details: { fixture: 'synthetic-image-failure' },
        });
      }
      return fnToolSuccessWithPng({
        summary: 'Synthetic image transport proof.',
        modelData: { width: 2, height: 2 },
        details: { fixture: 'synthetic-2x2-png' },
        image: { mimeType: 'image/png', data: SYNTHETIC_PNG_BASE64 },
      });
    },
  };
}

function injectSyntheticTool(service: AgentService, widgetId: string, sessionId: string): void {
  const session = service.sessionMap[widgetId]?.[sessionId]?.session as unknown as TMutableAgentSession | undefined;
  if (!session || session.getToolDefinition(SYNTHETIC_TOOL_NAME)) return;
  session._allowedToolNames?.add(SYNTHETIC_TOOL_NAME);
  session._customTools.push(createSyntheticTool());
  session._refreshToolRegistry();
  if (!session.getToolDefinition(SYNTHETIC_TOOL_NAME)) {
    throw new Error('Synthetic image tool was not admitted into the real Pi session.');
  }
}

function createChats() {
  const records = new Map<string, TChatRecord>();
  return {
    async get(args: Readonly<{ id: string }>) {
      return records.get(args.id) ?? null;
    },
    async create(args: Omit<TChatRecord, 'status'>) {
      const created = Object.freeze({ ...args, status: 'active' as const });
      records.set(args.id, created);
      return created;
    },
    async update(args: Readonly<{ id: string; name?: string; status?: TChatRecord['status'] }>) {
      const current = records.get(args.id);
      if (!current) return null;
      const updated = Object.freeze({ ...current, ...args });
      records.set(args.id, updated);
      return updated;
    },
  };
}

const dataPath = await mkdtemp(join(tmpdir(), 'omnidraw-agent-image-chat-'));
const eventPublisher = new EventPublisherService();
const resource = {
  getResource: async () => null,
  listResources: async () => [],
};
const service = new AgentService({
  dataPath,
  widgetDraftsRoot: join(dataPath, 'widgets', 'drafts'),
  eventPublisherService: eventPublisher,
  chats: createChats(),
  resourceService: resource,
});
await service.start({} as never);
service.modelRuntime.registerProvider(SYNTHETIC_PROVIDER, {
  api: 'synthetic-image-api' as never,
  baseUrl: 'http://127.0.0.1.invalid',
  apiKey: 'synthetic-image-test-key',
  models: [{
    id: SYNTHETIC_MODEL,
    name: 'Synthetic Image Model',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 16_000,
    maxTokens: 2_000,
  }],
  streamSimple: createSyntheticProviderStream as never,
});
await service.modelRuntime.setRuntimeApiKey(SYNTHETIC_PROVIDER, 'synthetic-image-test-key');
service.settingsManager.setDefaultModelAndProvider(SYNTHETIC_PROVIDER, SYNTHETIC_MODEL);

const agent = new Proxy(service, {
  get(target, property) {
    if (property === 'connectChat') {
      return async (widgetId: string, sessionId: string, mode?: 'replace' | 'reuse') => {
        const result = await target.connectChat(widgetId, sessionId, mode);
        injectSyntheticTool(target, widgetId, sessionId);
        return result;
      };
    }
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

const context = {
  agent,
  eventPublisher,
  resource,
  widgetCatalog: {
    current: () => ({
      format: 'omnidraw.widget-catalog.v1',
      generation: 1,
      digestSha256: '0'.repeat(64),
      rootIdentity: 'synthetic-image-fixture',
      healthy: true,
      entries: {},
      issues: [],
    }),
  },
} as unknown as TApiContext;
const baseOs = implement(apiContract).$context<TApiContext>();
const handler = new RPCHandler(baseOs.router(router), {
  interceptors: [onError((error) => console.error(error))],
});
const sockets = new Set<ServerWebSocket<unknown>>();
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: requestedPort,
  fetch(request, bunServer) {
    const url = new URL(request.url);
    if (url.pathname === '/api' && request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      if (bunServer.upgrade(request, { data: {} })) return undefined;
      return new Response('Upgrade failed', { status: 500 });
    }
    return new Response('Not found', { status: 404 });
  },
  websocket: {
    open(socket) {
      sockets.add(socket);
    },
    message(socket, message) {
      void handler.message(socket as never, message, { context }).catch((error) => {
        console.error(error);
      });
    },
    close(socket) {
      sockets.delete(socket);
      handler.close(socket as never);
    },
  },
});

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  for (const socket of sockets) socket.close(1001, 'Synthetic acceptance fixture stopped.');
  server.stop(true);
  await service.stop();
  await rm(dataPath, { recursive: true, force: true });
}

process.once('SIGTERM', () => {
  void stop().finally(() => process.exit(0));
});
process.once('SIGINT', () => {
  void stop().finally(() => process.exit(0));
});

console.log(`OMNIDRAW_AGENT_IMAGE_READY ${JSON.stringify({ port: server.port })}`);
