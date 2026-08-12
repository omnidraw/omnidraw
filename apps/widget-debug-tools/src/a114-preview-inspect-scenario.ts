import {
  apiChatConnect,
} from '@omnidraw/api/agent/api.chat.connect';
import {
  apiChatHistory,
} from '@omnidraw/api/agent/api.chat.history';
import {
  apiChatPrompt,
} from '@omnidraw/api/agent/api.chat.prompt';
import {
  AgentService,
  type TWidgetPreviewInspectionCapability,
  type TWidgetPreviewInspectionRequest,
} from '@omnidraw/service-agent';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const SCENARIO_NAME = 'a114-public-agent-preview-inspect';
const WIDGET_ID = 'widget-debug-tools';
const CHAT_ID = 'a114-preview-inspect';
const CANVAS_ID = 'a114-preview-canvas';
const WIDGET_NAME = 'A114 Inspection Fixture';
const PROVIDER_ID = 'widget-debug-tools-a114';
const MODEL_ID = 'public-agent-tool-scenario';
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAKAAAAB4CAYAAAB1ovlvAAAAYklEQVR4nO3BgQAAAADDoPlTH+ECVQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQNcALIcAAfgvpGIAAAAASUVORK5CYII=';
const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64');
const PNG_DIGEST_SHA256 = createHash('sha256').update(PNG_BYTES).digest('hex');

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
  stopReason: 'stop' | 'toolUse';
  timestamp: number;
}>;

type TProviderContext = Readonly<{
  messages: ReadonlyArray<Readonly<{
    role?: string;
    content?: unknown;
    details?: unknown;
    isError?: unknown;
    toolName?: unknown;
  }>>;
}>;

type TToolResultMessage = Readonly<{
  role?: string;
  content?: unknown;
  details?: unknown;
  isError?: unknown;
  toolName?: unknown;
}>;

type TChatRecord = Readonly<{
  id: string;
  canvasId: string | null;
  name: string;
  status: 'active' | 'archived' | 'error';
  workspaceRelativePath: string;
  historyRelativePath: string;
}>;

export type TA114PreviewInspectScenarioResult = Readonly<{
  scenario: typeof SCENARIO_NAME;
  passed: true;
  toolOrder: readonly [
    'od_widget_create',
    'od_widget_validate',
    'od_widget_preview_inspect',
  ];
  validation: Readonly<{
    ok: true;
    acceptedArtifactBuild: 'passed';
    livePreviewRuntime: 'not_exercised';
  }>;
  inspection: Readonly<{
    status: 'completed';
    overall: 'artifact_exact';
    source: 'exact';
    artifact: 'exact';
    bindings: 'unavailable';
    network: 'denied';
    imageCount: 1;
    screenshot: Readonly<{
      mimeType: 'image/png';
      width: 160;
      height: 120;
      byteSize: number;
      digestSha256: string;
    }>;
  }>;
}>;

function assertScenario(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(`${SCENARIO_NAME}: ${message}`);
}

function createUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function createAssistantMessage(
  content: readonly unknown[],
  stopReason: TAssistantMessage['stopReason'],
): TAssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'widget-debug-tools-a114-api',
    provider: PROVIDER_ID,
    model: MODEL_ID,
    usage: createUsage(),
    stopReason,
    timestamp: Date.now(),
  };
}

function createCompletedStream(message: TAssistantMessage) {
  return {
    async *[Symbol.asyncIterator]() {
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

function toolCall(name: string, sequence: number, args: unknown) {
  return createCompletedStream(createAssistantMessage([{
    type: 'toolCall',
    id: `a114-public-tool-${sequence}`,
    name,
    arguments: args,
  }], 'toolUse'));
}

function toolResultsSinceLatestUser(
  context: TProviderContext,
): TToolResultMessage[] {
  const userIndex = context.messages.findLastIndex((message) => message.role === 'user');
  return context.messages
    .slice(userIndex + 1)
    .filter((message) => message.role === 'toolResult');
}

function assertSuccessfulToolResult(
  result: TToolResultMessage | undefined,
  expectedToolName: string,
): Record<string, unknown> {
  assertScenario(result !== undefined, `Missing ${expectedToolName} result.`);
  assertScenario(result.toolName === expectedToolName, `Expected ${expectedToolName}, received ${String(result.toolName)}.`);
  assertScenario(result.isError !== true, `${expectedToolName} returned an error.`);
  assertScenario(
    typeof result.details === 'object' && result.details !== null && !Array.isArray(result.details),
    `${expectedToolName} did not return structured details.`,
  );
  return result.details as Record<string, unknown>;
}

function assertInspectionResult(result: TToolResultMessage | undefined): void {
  const details = assertSuccessfulToolResult(result, 'od_widget_preview_inspect');
  const fidelity = details.fidelity as Record<string, unknown> | undefined;
  const screenshot = details.screenshot as Record<string, unknown> | undefined;
  assertScenario(details.status === 'completed', 'Inspection did not complete.');
  assertScenario(fidelity?.overall === 'artifact_exact', 'Inspection did not report artifact_exact fidelity.');
  assertScenario(fidelity?.source === 'exact', 'Inspection did not report exact source capture.');
  assertScenario(fidelity?.artifact === 'exact', 'Inspection did not report an exact artifact.');
  assertScenario(fidelity?.bindings === 'unavailable', 'Inspection did not report artifact resources as unavailable.');
  assertScenario(fidelity?.network === 'denied', 'Inspection unexpectedly reported guest network access.');
  assertScenario(screenshot?.mimeType === 'image/png', 'Inspection screenshot metadata was not PNG.');
  assertScenario(screenshot?.width === 160 && screenshot.height === 120, 'Inspection screenshot dimensions changed.');
  assertScenario(screenshot?.byteSize === PNG_BYTES.byteLength, 'Inspection screenshot size changed.');
  assertScenario(screenshot?.digestSha256 === PNG_DIGEST_SHA256, 'Inspection screenshot digest changed.');

  const content = Array.isArray(result?.content) ? result.content : [];
  const images = content.filter((part) => (
    typeof part === 'object'
    && part !== null
    && 'type' in part
    && part.type === 'image'
  ));
  assertScenario(images.length === 1, 'Inspection did not return exactly one image block.');
  const image = images[0] as { mimeType?: unknown; data?: unknown };
  assertScenario(image.mimeType === 'image/png' && image.data === PNG_BASE64, 'Inspection PNG block changed.');
  const text = content
    .filter((part) => typeof part === 'object' && part !== null && 'type' in part && part.type === 'text')
    .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
    .join('');
  assertScenario(!text.includes(PNG_BASE64), 'Inspection duplicated PNG bytes into text.');
  assertScenario(!JSON.stringify(details).includes(PNG_BASE64), 'Inspection duplicated PNG bytes into details.');
}

function createScenarioProviderStream(_model: unknown, context: TProviderContext) {
  const results = toolResultsSinceLatestUser(context);
  if (results.length === 0) {
    return toolCall('od_widget_create', 1, {
      name: WIDGET_NAME,
      description: 'Public A114 inspection scenario.',
      template: 'plain',
    });
  }
  if (results.length === 1) {
    const details = assertSuccessfulToolResult(results[0], 'od_widget_create');
    assertScenario(details.name === WIDGET_NAME && details.draft === true, 'Create did not mount the expected draft.');
    return toolCall('od_widget_validate', 2, { name: WIDGET_NAME });
  }
  if (results.length === 2) {
    const details = assertSuccessfulToolResult(results[1], 'od_widget_validate');
    assertScenario(details.ok === true, 'Public validation did not pass.');
    assertScenario(details.acceptedArtifactBuild === 'passed', 'Public validation did not run the accepted artifact build check.');
    assertScenario(details.livePreviewRuntime === 'not_exercised', 'Public validation overstated live Preview runtime evidence.');
    return toolCall('od_widget_preview_inspect', 3, {
      name: WIDGET_NAME,
      viewport: { width: 160, height: 120, deviceScaleFactor: 1 },
      actions: [{ type: 'waitFrames', count: 1 }],
    });
  }
  assertScenario(results.length === 3, `Unexpected public tool result count ${results.length}.`);
  assertInspectionResult(results[2]);
  return createCompletedStream(createAssistantMessage([{
    type: 'text',
    text: 'A114 public create, validate, and artifact-exact inspection scenario passed.',
  }], 'stop'));
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
    async update(args: Readonly<{
      id: string;
      name?: string;
      status?: TChatRecord['status'];
    }>) {
      const current = records.get(args.id);
      if (!current) return null;
      const updated = Object.freeze({ ...current, ...args });
      records.set(args.id, updated);
      return updated;
    },
  };
}

function createInspectionCapability(): TWidgetPreviewInspectionCapability {
  return {
    async inspect(request: TWidgetPreviewInspectionRequest) {
      const action = request.input.actions[0];
      assertScenario(action?.type === 'waitFrames', 'Inspection request did not preserve the declared action.');
      const result = {
        status: 'completed' as const,
        identity: {
          name: request.name,
          widgetKey: request.widgetKey,
          draftDigestSha256: 'a'.repeat(64),
          executableInputDigestSha256: 'b'.repeat(64),
          environmentIdentity: 'widget-debug-tools-a114-fixture-v1',
        },
        artifact: {
          artifactDigestSha256: 'c'.repeat(64),
          capsuleArtifactHash: `sha256:${'d'.repeat(64)}` as const,
          constructionReused: false,
        },
        fidelity: {
          source: 'exact' as const,
          artifact: 'exact' as const,
          runtimePolicy: 'narrowed' as const,
          bindings: 'unavailable' as const,
          network: 'denied' as const,
          overall: 'artifact_exact' as const,
        },
        verification: {
          surface: 'artifact' as const,
          generation: 'current' as const,
          artifact: 'exact' as const,
          manifest: 'exact' as const,
          resources: 'not_available' as const,
          canvasParity: 'not_claimed' as const,
          visibleFrame: 'not_claimed' as const,
          executionTarget: 'diagnostic_clone' as const,
          previewState: 'not_applicable' as const,
          nextAction: 'use_preview_mode_for_resources' as const,
          functional: 'not_exercised' as const,
        },
        screenshot: {
          mimeType: 'image/png' as const,
          width: 160,
          height: 120,
          byteSize: PNG_BYTES.byteLength,
          digestSha256: PNG_DIGEST_SHA256,
        },
        evidence: {
          page: request.input.viewport,
          actions: [{
            index: 0,
            type: 'waitFrames' as const,
            status: 'passed' as const,
            matchedCount: 0,
            message: 'One declared frame wait passed.',
          }],
          diagnostics: { entries: [], droppedCount: 0, truncated: false },
          elements: { entries: [], scannedCount: 0, omittedCount: 0, truncated: false },
          canvases: { entries: [], omittedCount: 0, truncated: false },
        },
        durationMs: 1,
      };
      return { result, screenshotPng: PNG_BYTES };
    },
  };
}

function projectScenarioResult(history: readonly Readonly<{ message: unknown }>[]): TA114PreviewInspectScenarioResult {
  const toolResults = history
    .map((entry) => entry.message)
    .filter((message): message is TToolResultMessage => (
      typeof message === 'object'
      && message !== null
      && 'role' in message
      && message.role === 'toolResult'
    ));
  assertScenario(toolResults.length === 3, `API history returned ${toolResults.length} tool results.`);
  const create = assertSuccessfulToolResult(toolResults[0], 'od_widget_create');
  const validation = assertSuccessfulToolResult(toolResults[1], 'od_widget_validate');
  assertInspectionResult(toolResults[2]);
  assertScenario(create.name === WIDGET_NAME && create.draft === true, 'API history lost mounted-draft evidence.');
  assertScenario(validation.ok === true, 'API history lost validation success.');
  assertScenario(validation.acceptedArtifactBuild === 'passed', 'API history lost accepted artifact build evidence.');
  const inspection = toolResults[2]!.details as Record<string, unknown>;
  const fidelity = inspection.fidelity as Record<string, unknown>;
  const screenshot = inspection.screenshot as Record<string, unknown>;

  return Object.freeze({
    scenario: SCENARIO_NAME,
    passed: true,
    toolOrder: Object.freeze([
      'od_widget_create',
      'od_widget_validate',
      'od_widget_preview_inspect',
    ] as const),
    validation: Object.freeze({
      ok: true,
      acceptedArtifactBuild: 'passed',
      livePreviewRuntime: 'not_exercised',
    }),
    inspection: Object.freeze({
      status: 'completed',
      overall: fidelity.overall as 'artifact_exact',
      source: fidelity.source as 'exact',
      artifact: fidelity.artifact as 'exact',
      bindings: fidelity.bindings as 'unavailable',
      network: fidelity.network as 'denied',
      imageCount: 1,
      screenshot: Object.freeze({
        mimeType: 'image/png',
        width: 160,
        height: 120,
        byteSize: screenshot.byteSize as number,
        digestSha256: screenshot.digestSha256 as string,
      }),
    }),
  });
}

export async function runA114PreviewInspectScenario(
  args: Readonly<{ home: string }>,
): Promise<TA114PreviewInspectScenarioResult> {
  const service = new AgentService({
    dataPath: resolve(args.home, 'agent'),
    widgetDraftsRoot: resolve(args.home, 'widgets', 'drafts'),
    eventPublisherService: {
      publishAgentEvent: () => 0,
    } as never,
    chats: createChats(),
    chatScope: {
      validate: async ({ canvasId, widgetId }) => (
        canvasId === CANVAS_ID && widgetId === WIDGET_ID
      ),
    },
    widgetReferenceResolver: {
      resolve: async () => Object.freeze({
        digestSha256: 'a'.repeat(64),
        selections: Object.freeze([]),
      }),
      assertCurrent: async () => undefined,
    } as never,
    previewBuild: async () => ({ ok: true, errors: [] }),
    previewInspection: createInspectionCapability(),
  });
  let started = false;
  try {
    await service.start({} as never);
    started = true;
    service.modelRuntime.registerProvider(PROVIDER_ID, {
      api: 'widget-debug-tools-a114-api' as never,
      baseUrl: 'http://127.0.0.1.invalid',
      apiKey: 'widget-debug-tools-a114-key',
      models: [{
        id: MODEL_ID,
        name: 'A114 Public Agent Tool Scenario',
        reasoning: false,
        input: ['text', 'image'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 16_000,
        maxTokens: 2_000,
      }],
      streamSimple: createScenarioProviderStream as never,
    });
    await service.modelRuntime.setRuntimeApiKey(PROVIDER_ID, 'widget-debug-tools-a114-key');
    service.settingsManager.setDefaultModelAndProvider(PROVIDER_ID, MODEL_ID);

    const context = { agent: service } as never;
    const connect = apiChatConnect.callable({ context });
    const prompt = apiChatPrompt.callable({ context });
    const history = apiChatHistory.callable({ context });
    await connect({
      widgetId: WIDGET_ID,
      sessionId: CHAT_ID,
      canvasId: CANVAS_ID,
      mode: 'replace',
    });
    await prompt({
      widgetId: WIDGET_ID,
      sessionId: CHAT_ID,
      canvasId: CANVAS_ID,
      text: 'Run the fixed A114 public tool scenario.',
    });
    return projectScenarioResult(await history({ widgetId: WIDGET_ID, sessionId: CHAT_ID }));
  } finally {
    if (started) await service.stop();
  }
}

function parseHome(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== '--home' || argv[1]?.trim() === '') {
    throw new Error('Usage: bun run scenario:a114 -- --home <isolated-path>');
  }
  return resolve(process.cwd(), argv[1]!);
}

if (import.meta.main) {
  await runA114PreviewInspectScenario({ home: parseHome(process.argv.slice(2)) })
    .then((result) => {
      process.stdout.write(`A114_PREVIEW_INSPECTION_PASS ${JSON.stringify(result)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
