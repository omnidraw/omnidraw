import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createWidgetPreviewInspectTool } from '../tools/tool.widget-preview-inspect';
import { fnClassifyWidgetPreviewInspection } from '../tools/fn.widget-preview-inspect';
import type {
  TInspectIdentity,
  TWidgetPreviewInspectResult,
  TWidgetPreviewInspectionCapability,
  TWidgetPreviewInspectionRequest,
  TWidgetPreviewInspectionResponse,
} from '../tools/types';
import { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import { executeTool, makeTempDir } from './tool.test-helpers';
import { testChatId, testWorkspaceWorld } from './service.fixture';

const CHAT_ID = testChatId('widget-preview-inspect-tool');

type TResultResponse = Extract<TWidgetPreviewInspectionResponse, Readonly<{ result: TWidgetPreviewInspectResult }>>;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1
        ? 0xedb88320 ^ (crc >>> 1)
        : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(chunk, 4);
  Buffer.from(data).copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(Buffer.concat([typeBytes, Buffer.from(data)])),
    8 + data.byteLength,
  );
  return chunk;
}

function pngForDimensions(width: number, height: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const scanlines = Buffer.alloc((width + 1) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', new Uint8Array()),
  ]);
}

function identityFor(request: TWidgetPreviewInspectionRequest): TInspectIdentity {
  return {
    name: request.name,
    widgetKey: request.widgetKey,
    draftDigestSha256: request.input.expectedDraftDigestSha256 ?? 'a'.repeat(64),
    executableInputDigestSha256: 'b'.repeat(64),
    environmentIdentity: 'capsule-test-environment-v1',
  };
}

function completedResponse(request: TWidgetPreviewInspectionRequest): TResultResponse {
  const preview = request.input.mode === 'preview';
  const screenshotPng = pngForDimensions(
    request.input.viewport.width * request.input.viewport.deviceScaleFactor,
    request.input.viewport.height * request.input.viewport.deviceScaleFactor,
  );
  const result: TWidgetPreviewInspectResult = {
    status: 'completed',
    identity: identityFor(request),
    artifact: {
      artifactDigestSha256: 'c'.repeat(64),
      artifactHash: `sha256:${'d'.repeat(64)}`,
      constructionReused: false,
    },
    fidelity: preview
      ? {
          source: 'exact',
          artifact: 'exact',
          runtimePolicy: 'preview',
          bindings: 'manifest',
          network: 'denied',
          overall: 'preview_policy_exact',
        }
      : {
          source: 'exact',
          artifact: 'exact',
          runtimePolicy: 'narrowed',
          bindings: 'unavailable',
          network: 'denied',
          overall: 'artifact_exact',
        },
    verification: {
      surface: preview ? 'preview' : 'artifact',
      generation: 'current',
      artifact: 'exact',
      manifest: 'exact',
      resources: preview ? 'manifest_bound' : 'not_available',
      canvasParity: preview ? 'same_runtime_policy' : 'not_claimed',
      visibleFrame: 'not_claimed',
      executionTarget: 'diagnostic_clone',
      previewState: preview ? 'ready' : 'not_applicable',
      nextAction: preview ? 'none' : 'use_preview_mode_for_resources',
      functional: request.input.actions.some((action) => action.type !== 'waitFrames')
        ? 'observed'
        : 'not_exercised',
    },
    screenshot: {
      mimeType: 'image/png',
      width: request.input.viewport.width * request.input.viewport.deviceScaleFactor,
      height: request.input.viewport.height * request.input.viewport.deviceScaleFactor,
      byteSize: screenshotPng.byteLength,
      digestSha256: createHash('sha256').update(screenshotPng).digest('hex'),
    },
    evidence: {
      page: request.input.viewport,
      actions: request.input.actions.map((action, index) => ({
        index,
        type: action.type,
        status: 'passed',
        matchedCount: action.type === 'waitFrames' ? 0 : 1,
        message: 'passed',
      })),
      diagnostics: { entries: [], droppedCount: 0, truncated: false },
      elements: { entries: [], scannedCount: 0, omittedCount: 0, truncated: false },
      canvases: { entries: [], omittedCount: 0, truncated: false },
    },
    durationMs: 25,
  };
  return { result, screenshotPng };
}

async function createFixture(args: Readonly<{
  capability?: TWidgetPreviewInspectionCapability;
  authorize?: () => Promise<boolean>;
  configureWorkspace?(workspace: WidgetWorkspace): void;
  resolvePreviewScope?: () => Promise<Readonly<{
    canvasId: string;
    aiChatElementId: string;
  }> | null>;
}> = {}) {
  const root = await makeTempDir();
  const workspace = new WidgetWorkspace({
    ...testWorkspaceWorld(),
    dataPath: join(root, 'data'),
    draftRoot: join(root, 'widgets', 'drafts'),
  });
  await workspace.init();
  await workspace.ensureChat(CHAT_ID);
  await workspace.createDraft(CHAT_ID, { name: 'Preview Clock' }, async ({ cwd }) => {
    await mkdir(join(cwd, 'ui'), { recursive: true });
    await writeFile(join(cwd, 'omnidraw.json'), `${JSON.stringify({
      $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
      schemaVersion: 1,
      slug: 'preview-clock',
      name: 'Preview Clock',
      description: 'Preview inspection test fixture.',
      tool: { label: 'Preview Clock', group: null, priority: 0 },
      ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
    })}\n`, 'utf8');
    await writeFile(join(cwd, 'ui', 'main.ts'), 'document.body.textContent = "Preview";\n', 'utf8');
    return ['omnidraw.json', 'ui/main.ts'];
  });
  args.configureWorkspace?.(workspace);
  return createWidgetPreviewInspectTool({
    workspace,
    chatId: CHAT_ID,
    authorize: args.authorize ?? (async () => true),
    capability: args.capability,
    ...(args.resolvePreviewScope === undefined
      ? {}
      : { resolvePreviewScope: args.resolvePreviewScope }),
  });
}

describe('od_widget_preview_inspect', () => {
  test('classifies trusted warning failures and rendered error alerts as blocking', () => {
    const diagnostic = {
      fingerprint: 'function-output',
      origin: 'capability' as const,
      phase: 'function',
      code: 'FUNCTION_OUTPUT_INVALID',
      severity: 'warning' as const,
      message: 'Output did not match schema.',
      trust: 'trusted' as const,
      retryability: 'non-retryable' as const,
      occurrenceCount: 1,
    };
    expect(fnClassifyWidgetPreviewInspection({
      actions: [{
        index: 0,
        type: 'click',
        status: 'passed',
        matchedCount: 1,
        message: 'clicked',
      }],
      diagnostics: [diagnostic],
      elements: [],
    })).toBe('failed');
    expect(fnClassifyWidgetPreviewInspection({
      actions: [],
      diagnostics: [],
      elements: [{
        id: 1,
        tag: 'div',
        role: 'alert',
        text: 'Database failed to load',
        bounds: { x: 0, y: 0, width: 100, height: 20 },
        computed: { display: 'block', visibility: 'visible', opacity: '1' },
      }],
    })).toBe('failed');
  });

  test('resolves a mounted display name, forwards identity and cancellation, applies defaults, and returns one PNG block', async () => {
    const calls: TWidgetPreviewInspectionRequest[] = [];
    const tool = await createFixture({
      capability: {
        inspect: async (request) => {
          calls.push(request);
          return completedResponse(request);
        },
      },
    });
    const controller = new AbortController();
    const result = await tool.execute('inspect-call', {
      name: '  Preview   Clock  ',
      expectedDraftDigestSha256: 'e'.repeat(64),
      actions: [{
        type: 'input',
        target: { by: 'role', role: 'textbox', name: 'Title' },
        value: 'Ready',
      }],
    }, controller.signal, undefined, {} as never) as any;

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      chatId: CHAT_ID,
      toolCallId: 'inspect-call',
      name: 'Preview Clock',
      widgetKey: 'preview-clock',
      input: {
        name: 'Preview Clock',
        expectedDraftDigestSha256: 'e'.repeat(64),
        viewport: { width: 512, height: 384, deviceScaleFactor: 1 },
        settle: { frames: 2, timeoutMs: 5_000 },
        actions: [{ type: 'input', value: 'Ready', commit: 'blur' }],
        continueOnActionError: false,
        timeoutMs: 120_000,
      },
    });
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.signal).not.toBe(controller.signal);
    expect(calls[0]?.signal?.aborted).toBe(false);
    expect(result.isError).not.toBe(true);
    expect(result.details).toMatchObject({
      status: 'completed',
      artifact: { artifactHash: `sha256:${'d'.repeat(64)}` },
      fidelity: {
        runtimePolicy: 'narrowed',
        bindings: 'unavailable',
        network: 'denied',
        overall: 'artifact_exact',
      },
    });
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect(result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(result.content[0].text).not.toContain(result.content[1].data);
    expect(JSON.stringify(result.details)).not.toContain(result.content[1].data);
    expect(JSON.stringify(result.details)).not.toContain('capsuleArtifactHash');
  });

  test('requires exact Preview scope and reports diagnostic-clone parity without leaking scope IDs', async () => {
    const calls: TWidgetPreviewInspectionRequest[] = [];
    const tool = await createFixture({
      resolvePreviewScope: async () => ({
        canvasId: 'canvas-private-a',
        aiChatElementId: 'ai-chat-private-a',
      }),
      capability: {
        inspect: async (request) => {
          calls.push(request);
          return completedResponse(request);
        },
      },
    });
    const result = await executeTool(tool, {
      name: 'Preview Clock',
      mode: 'preview',
      expectedAcceptedGeneration: 7,
      actions: [{
        type: 'assertText',
        target: { by: 'label', text: 'Loaded rows' },
        text: 'Loaded rows',
      }],
    });

    expect(calls[0]).toMatchObject({
      input: { mode: 'preview', expectedAcceptedGeneration: 7 },
      scope: { canvasId: 'canvas-private-a', aiChatElementId: 'ai-chat-private-a' },
    });
    expect(result.isError).not.toBe(true);
    expect(result.details).toMatchObject({
      fidelity: { overall: 'preview_policy_exact', bindings: 'manifest' },
      verification: {
        surface: 'preview',
        resources: 'manifest_bound',
        canvasParity: 'same_runtime_policy',
        visibleFrame: 'not_claimed',
        functional: 'observed',
      },
    });
    expect(result.content[0]?.text).toContain('diagnostic clone');
    expect(JSON.stringify(result)).not.toContain('canvas-private-a');
    expect(JSON.stringify(result)).not.toContain('ai-chat-private-a');

    const unavailable = await createFixture({
      resolvePreviewScope: async () => null,
      capability: { inspect: async (request) => completedResponse(request) },
    });
    const unavailableResult = await executeTool(unavailable, {
      name: 'Preview Clock',
      mode: 'preview',
    });
    expect(unavailableResult.isError).toBe(true);
    expect(unavailableResult.content[0]?.text).toContain('PREVIEW_SCOPE_UNAVAILABLE');
  });

  test('accepts the trusted source-map filename alphabet without weakening widget URLs', async () => {
    const safeFile = 'widget://src/@scope/foo+bar,theme=light~v1.ts' as const;
    const tool = await createFixture({
      capability: {
        inspect: async (request) => {
          const response = completedResponse(request);
          if (
            response.result.status !== 'completed'
            && response.result.status !== 'completed_with_errors'
          ) throw new Error('Expected a completed fixture result.');
          return {
            ...response,
            result: {
              ...response.result,
              evidence: {
                ...response.result.evidence,
                diagnostics: {
                  entries: [{
                    fingerprint: 'mapped-source-location',
                    origin: 'guest',
                    phase: 'runtime',
                    code: 'GUEST_DIAGNOSTIC',
                    severity: 'info',
                    message: 'Mapped source location.',
                    trust: 'untrusted',
                    retryability: 'unknown',
                    occurrenceCount: 1,
                    location: { file: safeFile, line: 3, column: 7 },
                  }],
                  droppedCount: 0,
                  truncated: false,
                },
              },
            },
          };
        },
      },
    });

    const result = await executeTool(tool, { name: 'Preview Clock' }) as any;
    expect(result.isError).not.toBe(true);
    expect(result.details.evidence.diagnostics.entries[0].location.file).toBe(safeFile);
  });

  test('rejects unknown fields and UTF-8 or action bounds before invoking the capability', async () => {
    let calls = 0;
    const tool = await createFixture({
      capability: {
        inspect: async (request) => {
          calls += 1;
          return completedResponse(request);
        },
      },
    });
    const invalidInputs = [
      { name: 'Preview Clock', effectPolicy: 'preview_exact' },
      { name: 'Preview Clock', mode: 'preview', resourceId: 'resource-private-a' },
      { name: 'Preview Clock', mode: 'preview', bindings: { store: 'resource-private-a' } },
      { name: 'Preview Clock', viewport: { width: 512, hostSelector: '#app' } },
      { name: 'Preview Clock', actions: [{ type: 'click', target: { by: 'css', selector: 'é'.repeat(257) } }] },
      { name: 'Preview Clock', actions: [{ type: 'input', target: { by: 'role', role: 'textbox' }, value: 'é'.repeat(2_049) }] },
      { name: 'Preview Clock', actions: [{ type: 'waitFrames', count: 121 }] },
      { name: 'Preview Clock', actions: Array.from({ length: 17 }, () => ({ type: 'waitFrames', count: 1 })) },
      { name: 'Preview Clock', timeoutMs: 180_001 },
    ];

    for (const input of invalidInputs) {
      const result = await executeTool(tool, input);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('WIDGET_PREVIEW_INSPECT_INPUT_INVALID');
    }
    expect(calls).toBe(0);
  });

  test('authorizes before capability use and reports missing host or mounted drafts as structured errors', async () => {
    let calls = 0;
    const denied = await createFixture({
      authorize: async () => false,
      capability: {
        inspect: async (request) => {
          calls += 1;
          return completedResponse(request);
        },
      },
    });
    const deniedResult = await executeTool(denied, { name: 'Preview Clock' });
    expect(deniedResult.isError).toBe(true);
    expect(deniedResult.content[0]?.text).toContain('TOOL_NOT_AUTHORIZED');
    expect(calls).toBe(0);

    const unavailable = await createFixture();
    const unavailableResult = await executeTool(unavailable, { name: 'Preview Clock' });
    expect(unavailableResult.isError).toBe(true);
    expect(unavailableResult.content[0]?.text).toContain('WIDGET_PREVIEW_INSPECTION_UNAVAILABLE');

    const missing = await createFixture({
      capability: { inspect: async (request) => completedResponse(request) },
    });
    const missingResult = await executeTool(missing, { name: 'Missing Widget' });
    expect(missingResult.isError).toBe(true);
    expect(missingResult.content[0]?.text).toContain('WIDGET_PREVIEW_INSPECT_DRAFT_UNAVAILABLE');
  });

  test('enforces the whole-call timeout while authorization is pending', async () => {
    let capabilityCalls = 0;
    const tool = await createFixture({
      authorize: () => new Promise<boolean>(() => undefined),
      capability: {
        inspect: async (request) => {
          capabilityCalls += 1;
          return completedResponse(request);
        },
      },
    });

    const startedAt = Date.now();
    const result = await executeTool(tool, {
      name: 'Preview Clock',
      timeoutMs: 10,
    });

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('WIDGET_PREVIEW_INSPECT_TIMED_OUT');
    expect(capabilityCalls).toBe(0);
  });

  test('keeps cancellation authoritative when authorization settles in the abort grace tick', async () => {
    let settleAuthorization!: (authorized: boolean) => void;
    let markAuthorizationStarted!: () => void;
    const authorizationStarted = new Promise<void>((resolve) => {
      markAuthorizationStarted = resolve;
    });
    const tool = await createFixture({
      authorize: () => {
        markAuthorizationStarted();
        return new Promise<boolean>((resolve) => {
          settleAuthorization = resolve;
        });
      },
      capability: {
        inspect: async (request) => completedResponse(request),
      },
    });
    const controller = new AbortController();
    const execution = tool.execute(
      'inspect-authorization-cancel-race',
      { name: 'Preview Clock' },
      controller.signal,
      undefined,
      {} as never,
    ) as Promise<any>;
    await authorizationStarted;

    controller.abort();
    settleAuthorization(false);
    const result = await execution;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('WIDGET_PREVIEW_INSPECT_CANCELLED');
    expect(result.content[0]?.text).not.toContain('TOOL_NOT_AUTHORIZED');
  });

  test('projects a failed union member as evidence rather than converting it to a tool error', async () => {
    const tool = await createFixture({
      capability: {
        inspect: async (request) => ({
          result: {
            status: 'failed',
            stage: 'mount',
            failure: { code: 'CAPSULE_MOUNT_FAILED', message: 'The isolated mount failed.', retryable: true },
            identity: identityFor(request),
            artifact: {
              artifactDigestSha256: 'c'.repeat(64),
              artifactHash: `sha256:${'d'.repeat(64)}`,
              constructionReused: true,
            },
            verification: {
              surface: 'artifact',
              generation: 'current',
              artifact: 'exact',
              manifest: 'exact',
              resources: 'not_available',
              canvasParity: 'not_claimed',
              visibleFrame: 'not_claimed',
              executionTarget: 'diagnostic_clone',
              previewState: 'not_applicable',
              nextAction: 'use_preview_mode_for_resources',
              functional: 'failed',
            },
            durationMs: 30,
          },
        }),
      },
    });
    const result = await executeTool(tool, { name: 'Preview Clock' });
    expect(result.isError).not.toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.details).toEqual({
      status: 'failed',
      stage: 'mount',
      failure: { code: 'CAPSULE_MOUNT_FAILED', message: 'The isolated mount failed.', retryable: true },
      identity: expect.objectContaining({ name: 'Preview Clock', widgetKey: 'preview-clock' }),
      artifact: expect.objectContaining({ constructionReused: true }),
      verification: {
        surface: 'artifact',
        generation: 'current',
        artifact: 'exact',
        manifest: 'exact',
        resources: 'not_available',
        canvasParity: 'not_claimed',
        visibleFrame: 'not_claimed',
        executionTarget: 'diagnostic_clone',
        previewState: 'not_applicable',
        nextAction: 'use_preview_mode_for_resources',
        functional: 'failed',
      },
      durationMs: 30,
    });
  });

  test('projects a bounded pre-execution capability failure as a structured tool error', async () => {
    const observedDraftDigestSha256 = 'f'.repeat(64);
    const tool = await createFixture({
      capability: {
        inspect: async () => ({
          toolError: {
            code: 'WIDGET_PREVIEW_INSPECT_DRAFT_STALE',
            message: 'The draft changed before isolated browser execution.',
            retryable: true,
            observedDraftDigestSha256,
            previewState: 'generation_mismatch',
            nextAction: 'retry_current_generation',
          },
        }),
      },
    });
    const result = await executeTool(tool, {
      name: 'Preview Clock',
      expectedDraftDigestSha256: 'e'.repeat(64),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('WIDGET_PREVIEW_INSPECT_DRAFT_STALE');
    expect(result.content[0]?.text).toContain(observedDraftDigestSha256);
    expect(result.content[0]?.text).toContain('generation_mismatch');
    expect(result.content[0]?.text).toContain('retry_current_generation');
    expect(result.content[0]?.text).not.toContain('screenshotPng');
  });

  test('rejects identity, result-shape, and screenshot-coherence protocol corruption', async () => {
    const cases: TWidgetPreviewInspectionCapability[] = [
      {
        inspect: async (request) => {
          const response = completedResponse(request);
          return {
            ...response,
            result: { ...response.result, identity: { ...response.result.identity, widgetKey: 'other-widget' } },
          } as TWidgetPreviewInspectionResponse;
        },
      },
      {
        inspect: async (request) => {
          const response = completedResponse(request);
          return { result: response.result };
        },
      },
      {
        inspect: async (request) => {
          const response = completedResponse(request);
          const artifact = response.result.artifact!;
          const { artifactHash, ...withoutArtifactHash } = artifact;
          return {
            ...response,
            result: {
              ...response.result,
              artifact: { ...withoutArtifactHash, capsuleArtifactHash: artifactHash },
            },
          } as unknown as TWidgetPreviewInspectionResponse;
        },
      },
      {
        inspect: async (request) => {
          const response = completedResponse(request);
          return {
            ...response,
            result: {
              ...response.result,
              screenshot: { ...response.result.screenshot!, digestSha256: 'e'.repeat(64) },
            },
          } as TWidgetPreviewInspectionResponse;
        },
      },
    ];

    for (const capability of cases) {
      const tool = await createFixture({ capability });
      const result = await executeTool(tool, { name: 'Preview Clock' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('WIDGET_PREVIEW_INSPECT_PROTOCOL_INVALID');
    }
  });

  test('cancels or times out while queued without invoking the inspection capability', async () => {
    let calls = 0;
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const tool = await createFixture({
      capability: {
        inspect: async (request) => {
          calls += 1;
          if (calls === 1) {
            markFirstStarted();
            await firstRelease;
          }
          return completedResponse(request);
        },
      },
    });

    const first = tool.execute(
      'inspect-first',
      { name: 'Preview Clock' },
      undefined,
      undefined,
      {} as never,
    ) as Promise<any>;
    await firstStarted;

    const controller = new AbortController();
    const cancelled = tool.execute(
      'inspect-cancelled',
      { name: 'Preview Clock' },
      controller.signal,
      undefined,
      {} as never,
    ) as Promise<any>;
    controller.abort();
    const cancelledResult = await cancelled;
    expect(cancelledResult.isError).toBe(true);
    expect(cancelledResult.content[0]?.text).toContain('WIDGET_PREVIEW_INSPECT_CANCELLED');
    expect(calls).toBe(1);

    const timedOutResult = await executeTool(tool, {
      name: 'Preview Clock',
      timeoutMs: 5,
    });
    expect(timedOutResult.isError).toBe(true);
    expect(timedOutResult.content[0]?.text).toContain('WIDGET_PREVIEW_INSPECT_TIMED_OUT');
    expect(calls).toBe(1);

    releaseFirst();
    await first;
  });

  test('rejects a mounted-name remap observed after acquiring the authoring lane', async () => {
    let capabilityCalls = 0;
    let mountReads = 0;
    const tool = await createFixture({
      configureWorkspace(workspace) {
        const findMountedWidget = workspace.findMountedWidget.bind(workspace);
        workspace.findMountedWidget = async (...args) => {
          const mount = await findMountedWidget(...args);
          mountReads += 1;
          return mountReads === 2
            ? { ...mount, targetPath: `${mount.targetPath}-remapped` }
            : mount;
        };
      },
      capability: {
        inspect: async (request) => {
          capabilityCalls += 1;
          return completedResponse(request);
        },
      },
    });

    const result = await executeTool(tool, { name: 'Preview Clock' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('WIDGET_PREVIEW_INSPECT_DRAFT_UNAVAILABLE');
    expect(capabilityCalls).toBe(0);
  });

  test('propagates a whole-call deadline to an active capability as a timeout', async () => {
    let observedReason: unknown;
    const tool = await createFixture({
      capability: {
        inspect: async (request) => {
          await new Promise<void>((resolve) => {
            const resolveAborted = () => {
              observedReason = request.signal?.reason;
              resolve();
            };
            if (request.signal?.aborted) resolveAborted();
            else request.signal?.addEventListener('abort', resolveAborted, { once: true });
          });
          return {
            result: {
              status: 'timed_out',
              stage: 'build',
              failure: {
                code: 'PREVIEW_INSPECTION_TIMED_OUT',
                message: 'Preview inspection exceeded its whole-call timeout.',
                retryable: true,
              },
              identity: identityFor(request),
              verification: {
                surface: 'artifact',
                generation: 'current',
                artifact: 'exact',
                manifest: 'exact',
                resources: 'not_available',
                canvasParity: 'not_claimed',
                visibleFrame: 'not_claimed',
                executionTarget: 'diagnostic_clone',
                previewState: 'not_applicable',
                nextAction: 'use_preview_mode_for_resources',
                functional: 'failed',
              },
              durationMs: request.input.timeoutMs,
            },
          };
        },
      },
    });

    const result = await executeTool(tool, {
      name: 'Preview Clock',
      timeoutMs: 100,
    });
    expect(observedReason).toBe('inspection-timeout');
    expect(result.isError).not.toBe(true);
    expect(result.details).toMatchObject({
      status: 'timed_out',
      failure: { code: 'PREVIEW_INSPECTION_TIMED_OUT' },
    });
  });

  test('does not accept a completed result returned after the whole-call deadline', async () => {
    const tool = await createFixture({
      capability: {
        inspect: async (request) => {
          await new Promise<void>((resolve) => {
            if (request.signal?.aborted) resolve();
            else request.signal?.addEventListener('abort', () => resolve(), { once: true });
          });
          return completedResponse(request);
        },
      },
    });

    const result = await executeTool(tool, {
      name: 'Preview Clock',
      timeoutMs: 100,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('WIDGET_PREVIEW_INSPECT_TIMED_OUT');
  });

  test('returns at the whole-call deadline when the capability ignores cancellation', async () => {
    let observedSignal: AbortSignal | undefined;
    const tool = await createFixture({
      capability: {
        inspect: (request) => {
          observedSignal = request.signal;
          return new Promise<TWidgetPreviewInspectionResponse>(() => undefined);
        },
      },
    });

    const startedAt = Date.now();
    const result = await executeTool(tool, {
      name: 'Preview Clock',
      timeoutMs: 10,
    });

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(observedSignal?.aborted).toBe(true);
    expect(observedSignal?.reason).toBe('inspection-timeout');
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('WIDGET_PREVIEW_INSPECT_TIMED_OUT');
  });
});
