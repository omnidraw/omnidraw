#!/usr/bin/env bun

/**
 * Browser acceptance for the real Omnidraw applications.
 *
 * The packed public-package browser gate remains separate. This suite starts
 * the source-run backend and the actual Vite frontend against an isolated
 * Omnidraw home, then exercises the route families recorded in the screen
 * atlas and the frontend's native WebSocket generation fence.
 */

import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';

type TPortReservation = Readonly<{
  port: number;
  release(): Promise<void>;
}>;

type TManagedProcess = Readonly<{
  child: ReturnType<typeof Bun.spawn>;
  label: string;
  stderr: Promise<string>;
  stdout: Promise<string>;
}>;

type TRpcConnectionEvidence = Readonly<{
  actualMessagesAfterNewerOpen: number;
  closeCode: number | null;
  closed: boolean;
  id: number;
  incomingFrameCount: number;
  incomingFrames: readonly string[];
  openSequence: number | null;
  opened: boolean;
  outgoingFrames: readonly string[];
  outgoingFrameCount: number;
  url: string;
}>;

type TTransportEvidence = Readonly<{
  rpcConnections: readonly TRpcConnectionEvidence[];
  rpcOpenCount: number;
}>;

type TWidgetRuntimeDiagnostics = Readonly<{
  format: 'omnidraw.widget-runtime-diagnostics.v1';
  scheduler: Readonly<{
    concurrency: number;
    active: number;
    queued: number;
    deferred: number;
    peakActive: number;
    started: number;
    completed: number;
    cancelled: number;
    firstStartedAtMs: number | null;
    lastStartedAtMs: number | null;
    firstCompletedAtMs: number | null;
    lastCompletedAtMs: number | null;
    recentStarts: readonly string[];
  }>;
  browserHost: Readonly<{
    liveHosts: number;
    liveMounts: number;
    hostCreations: number;
    artifactCache: Readonly<{
      entries: number;
      totalBytes: number;
      hits: number;
      misses: number;
      puts: number;
      evictions: number;
    }>;
    pendingArtifactAdmissions: number;
  }>;
  mounts: readonly Readonly<{
    nodeId: string;
    instanceId: string;
    artifactHash: string;
    state: string;
    generation: number;
    viewport?: Readonly<{
      visibility: string;
    }>;
  }>[];
}>;

type TRpcWireRequest = Readonly<{
  complete: boolean;
  connectionId: number;
  exit: null | Readonly<{ _tag?: string; cause?: unknown; value?: unknown }>;
  input: unknown;
  path: string;
  requestId: number;
}>;

type TCreatedResource = Readonly<{
  id: string;
  kind: 'db' | 'kv';
  name: string;
  status: string;
}>;

type TCreatedCanvas = Readonly<{
  id: string;
  name: string;
}>;

type TFakeProviderRequest = Readonly<{
  authorization: string | null;
  messageText: string;
  model: unknown;
  path: string;
  reasoningEffort: unknown;
  stream: unknown;
}>;

type TFakeProvider = Readonly<{
  baseUrl: string;
  requests: readonly TFakeProviderRequest[];
  releaseResponse(): void;
  stop(): void;
}>;

const ROOT = resolve(import.meta.dir, '../..');
const BACKEND_ROOT = join(ROOT, 'apps/backend');
const FRONTEND_ROOT = join(ROOT, 'apps/frontend');
const SDK_ROOT = join(ROOT, 'packages/sdk');
const VITE_BIN = join(FRONTEND_ROOT, 'node_modules/vite/bin/vite.js');
const ROUTE_TIMEOUT_MS = 20_000;
const FUNCTION_RESOURCE_WIDGET_KEY = 'browser-function-resource';
const FUNCTION_RESOURCE_KEY = 'acceptance/preview-bridge';
const FUNCTION_RESOURCE_VALUE = 'portable-resource-ok';
const FAKE_PROVIDER_ID = 'browser-local';
const FAKE_MODEL_ID = 'browser-stream-model';
const FAKE_MODEL_NAME = 'Browser Streaming Model';
const PROMPT_TEXT = 'Return the deterministic browser acceptance reply.';
const PARTIAL_RESPONSE_TEXT = 'Browser acceptance';
const COMPLETE_RESPONSE_TEXT = 'Browser acceptance streamed reply.';
const SOLID_DEV_DIAGNOSTIC = /\b(?:ASYNC_OUTSIDE_LOADING_BOUNDARY|PENDING_ASYNC_UNTRACKED_READ|REACTIVE_WRITE_IN_OWNED_SCOPE|REACTIVITY_HALTED|SETTLED_CLEANUP_UNOWNED|STRICT_READ_UNTRACKED)\b/;
const sdkPackage = JSON.parse(await readFile(join(SDK_ROOT, 'package.json'), 'utf8')) as {
  version?: unknown;
};
assert.equal(typeof sdkPackage.version, 'string', 'The workspace SDK package has no release marker.');
const SDK_VERSION = String(sdkPackage.version);

function functionResourceManifest(resourceId?: string): Readonly<Record<string, unknown>> {
  return Object.freeze({
    $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
    schemaVersion: 1,
    name: 'Browser Function Resource Widget',
    slug: FUNCTION_RESOURCE_WIDGET_KEY,
    description: 'Exercises the fixed Preview function and portable resource bridge.',
    tool: {
      label: 'Browser Function Resource Widget',
      group: 'acceptance',
      priority: 4,
    },
    ui: {
      runtime: 'capsule',
      entry: 'ui/main.ts',
      apis: ['DOM'],
    },
    server: { entry: 'server/main.server.ts' },
    resources: [{
      slot: 'store',
      ...(resourceId === undefined ? {} : { resourceId }),
      kind: 'kv',
      effect: 'read',
      required: true,
    }],
  });
}

const FUNCTION_RESOURCE_UI_SOURCE = [
  'import { readAcceptanceValue } from "../server/main.server";',
  'const root = document.createElement("section");',
  'root.textContent = "Preview function/resource bridge pending";',
  'root.style.cssText = "box-sizing:border-box;min-height:240px;padding:24px;background:#4b1d1d;color:#ffffff";',
  'document.body.style.margin = "0";',
  'document.body.append(root);',
  `void readAcceptanceValue({ key: ${JSON.stringify(FUNCTION_RESOURCE_KEY)} }).then((result) => {`,
  `  if (result.value !== ${JSON.stringify(FUNCTION_RESOURCE_VALUE)} || result.revision !== 1) throw new Error("Unexpected Preview resource result.");`,
  '  root.textContent = `Preview function/resource bridge: ${result.value}`;',
  '  root.style.background = "#14c96f";',
  '});',
  '',
].join('\n');

const FUNCTION_RESOURCE_SERVER_SOURCE = [
  'import { defineServerFunction } from "@omnidraw/sdk/server";',
  'const inputSchema = Object.freeze({',
  '  parse(value: unknown): { key: string } {',
  '    if (value === null || typeof value !== "object" || typeof (value as { key?: unknown }).key !== "string") {',
  '      throw new TypeError("Expected one resource key.");',
  '    }',
  '    return { key: (value as { key: string }).key };',
  '  },',
  '  toJSONSchema() {',
  '    return { type: "object", required: ["key"], additionalProperties: false, properties: { key: { type: "string" } } };',
  '  },',
  '});',
  'const outputSchema = Object.freeze({',
  '  parse(value: unknown): { value: string; revision: number } {',
  '    if (value === null || typeof value !== "object") throw new TypeError("Expected one resource value.");',
  '    const candidate = value as { value?: unknown; revision?: unknown };',
  '    if (typeof candidate.value !== "string" || !Number.isInteger(candidate.revision)) {',
  '      throw new TypeError("Expected a string value and integer revision.");',
  '    }',
  '    return { value: candidate.value, revision: candidate.revision as number };',
  '  },',
  '  toJSONSchema() {',
  '    return { type: "object", required: ["value", "revision"], additionalProperties: false, properties: { value: { type: "string" }, revision: { type: "integer" } } };',
  '  },',
  '});',
  'export const readAcceptanceValue = defineServerFunction({',
  '  effect: "fx",',
  '  input: inputSchema,',
  '  output: outputSchema,',
  '  resources: { store: "read" },',
  '}, async (context, input) => {',
  '  const entry = await context.resources.read<{ value: unknown; revision: number } | null>("store", "get", { key: input.key });',
  '  if (entry === null || typeof entry.value !== "string") throw new TypeError("Acceptance resource value is unavailable.");',
  '  return { value: entry.value, revision: entry.revision };',
  '});',
  '',
].join('\n');

function failMessage(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

async function reservePort(): Promise<TPortReservation> {
  const server = createServer();
  const port = await new Promise<number>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Could not reserve a TCP port for browser acceptance.'));
        return;
      }
      resolvePort(address.port);
    });
  });
  let released = false;
  return Object.freeze({
    port,
    release: () => new Promise<void>((resolveRelease, reject) => {
      if (released) {
        resolveRelease();
        return;
      }
      released = true;
      server.close((error) => error ? reject(error) : resolveRelease());
    }),
  });
}

function startFakeProvider(): TFakeProvider {
  const encoder = new TextEncoder();
  const requests: TFakeProviderRequest[] = [];
  const pendingResponseReleases: Array<() => void> = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 30,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
        return Response.json({ error: { message: 'Unknown deterministic provider route.' } }, { status: 404 });
      }
      const payload = record(await request.json());
      requests.push(Object.freeze({
        authorization: request.headers.get('authorization'),
        messageText: JSON.stringify(payload.messages ?? null),
        model: payload.model,
        path: url.pathname,
        reasoningEffort: payload.reasoning_effort,
        stream: payload.stream,
      }));
      let releaseResponse!: () => void;
      const responseGate = new Promise<void>((resolveResponse) => {
        releaseResponse = resolveResponse;
      });
      pendingResponseReleases.push(releaseResponse);
      const chunk = (content: unknown) => encoder.encode(`data: ${JSON.stringify(content)}\n\n`);
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(chunk({
            id: 'chatcmpl-browser-acceptance',
            object: 'chat.completion.chunk',
            created: 0,
            model: FAKE_MODEL_ID,
            choices: [{ index: 0, delta: { role: 'assistant', content: PARTIAL_RESPONSE_TEXT }, finish_reason: null }],
          }));
          await responseGate;
          controller.enqueue(chunk({
            id: 'chatcmpl-browser-acceptance',
            object: 'chat.completion.chunk',
            created: 0,
            model: FAKE_MODEL_ID,
            choices: [{ index: 0, delta: { content: ' streamed reply.' }, finish_reason: null }],
          }));
          controller.enqueue(chunk({
            id: 'chatcmpl-browser-acceptance',
            object: 'chat.completion.chunk',
            created: 0,
            model: FAKE_MODEL_ID,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          }));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(body, {
        headers: {
          'Cache-Control': 'no-cache',
          'Content-Type': 'text/event-stream',
        },
      });
    },
  });
  return Object.freeze({
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    requests,
    releaseResponse() {
      const release = pendingResponseReleases.shift();
      assert.ok(release !== undefined, 'The deterministic provider had no pending streamed response to release.');
      release();
    },
    stop() {
      server.stop(true);
    },
  });
}

async function seedAgentModel(home: string, providerBaseUrl: string): Promise<void> {
  const agentRoot = join(home, 'agent/pi/agent');
  await mkdir(agentRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(agentRoot, 'models.json'), `${JSON.stringify({
    providers: {
      [FAKE_PROVIDER_ID]: {
        name: 'Browser Local Provider',
        baseUrl: providerBaseUrl,
        apiKey: 'browser-acceptance-key',
        api: 'openai-completions',
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
          supportsUsageInStreaming: false,
          maxTokensField: 'max_tokens',
        },
        models: [{
          id: FAKE_MODEL_ID,
          name: FAKE_MODEL_NAME,
          reasoning: true,
          thinkingLevelMap: { xhigh: 'xhigh' },
          input: ['text'],
          contextWindow: 32_000,
          maxTokens: 1_024,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }],
      },
    },
  }, null, 2)}\n`, { mode: 0o600 });
}

function spawnProcess(args: Readonly<{
  command: readonly string[];
  cwd: string;
  env?: Readonly<Record<string, string | undefined>>;
  label: string;
}>): TManagedProcess {
  const child = Bun.spawn([...args.command], {
    cwd: args.cwd,
    env: { ...process.env, ...args.env },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return Object.freeze({
    child,
    label: args.label,
    stdout: new Response(child.stdout).text(),
    stderr: new Response(child.stderr).text(),
  });
}

async function processFailure(process: TManagedProcess): Promise<Error> {
  const [stdout, stderr] = await Promise.all([process.stdout, process.stderr]);
  return new Error([
    `${process.label} exited before browser acceptance completed (exit ${process.child.exitCode}).`,
    stdout.trim(),
    stderr.trim(),
  ].filter(Boolean).join('\n'));
}

async function stopProcess(process: TManagedProcess): Promise<void> {
  if (process.child.exitCode === null) process.child.kill('SIGTERM');
  await Promise.race([process.child.exited, Bun.sleep(2_000)]);
  if (process.child.exitCode === null) process.child.kill('SIGKILL');
  await process.child.exited;
  await Promise.all([process.stdout, process.stderr]);
}

async function waitForHttp(url: string, process: TManagedProcess): Promise<void> {
  const deadline = Date.now() + ROUTE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (process.child.exitCode !== null) throw await processFailure(process);
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return;
    } catch {
      // The listener is still starting.
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for ${process.label} at ${url}.`);
}

async function waitForBrowserState<T>(args: Readonly<{
  label: string;
  read(): Promise<T>;
  ready(value: T): boolean;
}>): Promise<T> {
  const deadline = Date.now() + ROUTE_TIMEOUT_MS;
  let latest: T | undefined;
  let latestNavigationError: string | undefined;
  while (Date.now() < deadline) {
    try {
      latest = await args.read();
      latestNavigationError = undefined;
    } catch (error) {
      const message = failMessage(error);
      if (!/(?:execution context was destroyed|most likely because of a navigation|cannot find context with specified id|frame was detached)/iu.test(message)) {
        throw error;
      }
      latestNavigationError = message;
      await Bun.sleep(100);
      continue;
    }
    if (args.ready(latest)) return latest;
    await Bun.sleep(100);
  }
  throw new Error(
    `Timed out waiting for ${args.label}. Last evidence: ${JSON.stringify(latest, (key, value) => (
      key === 'bytesBase64'
        ? '[redacted artifact bytes]'
        : typeof value === 'string' && value.length > 1_000
          ? `${value.slice(0, 1_000)}…`
          : value
    )).slice(0, 8_000)}`
    + (latestNavigationError === undefined ? '' : ` Last navigation race: ${latestNavigationError}`),
  );
}

async function assertDraftGuestMounted(
  page: Page,
  portal: ReturnType<Page['locator']>,
  label: string,
): Promise<void> {
  await waitForBrowserState({
    label: `${label} host content`,
    read: () => portal.evaluate((element) => element.childElementCount),
    ready: (childCount) => childCount > 0,
  });
  try {
    await waitForBrowserState({
      label: `${label} painted guest marker`,
      read: async () => {
        const bounds = await portal.boundingBox();
        if (bounds === null) return { darkPixels: 0, height: 0, width: 0 };
        const viewportImage = await page.screenshot();
        const encoded = viewportImage.toString('base64');
        return page.evaluate(async ({ imageBase64, portalBounds }) => {
          const image = new Image();
          image.src = `data:image/png;base64,${imageBase64}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (context === null) return { darkPixels: 0, height: 0, width: 0 };
          context.drawImage(image, 0, 0);
          const x = Math.max(0, Math.floor(portalBounds.x));
          const y = Math.max(0, Math.floor(portalBounds.y));
          const width = Math.max(0, Math.min(Math.ceil(portalBounds.width), canvas.width - x));
          const height = Math.max(0, Math.min(96, Math.ceil(portalBounds.height), canvas.height - y));
          const pixels = context.getImageData(x, y, width, height).data;
          let darkPixels = 0;
          for (let offset = 0; offset < pixels.length; offset += 4) {
            if (pixels[offset]! < 96 && pixels[offset + 1]! < 96 && pixels[offset + 2]! < 96 && pixels[offset + 3]! > 200) {
              darkPixels += 1;
            }
          }
          return { darkPixels, height, width };
        }, { imageBase64: encoded, portalBounds: bounds });
      },
      ready: (marker) => marker.darkPixels >= 40,
    });
  } catch (error) {
    await mkdir(join(ROOT, 'tests/artifacts'), { recursive: true });
    await page.screenshot({
      path: join(ROOT, 'tests/artifacts/live-draft-preview-optical-failure.png'),
      fullPage: true,
    });
    throw error;
  }
  assert.equal(
    await page.getByText('Browser Acceptance Widget mounted', { exact: true }).count(),
    0,
    `${label} leaked guest DOM through the closed Capsule boundary.`,
  );
}

async function assertFunctionResourceGuestConsumed(
  page: Page,
  portal: ReturnType<Page['locator']>,
): Promise<void> {
  await waitForBrowserState({
    label: 'the closed Capsule guest to consume and paint the exact resource result',
    read: async () => {
      const bounds = await portal.boundingBox();
      if (bounds === null) return { greenPixels: 0 };
      const viewportImage = await page.screenshot();
      const encoded = viewportImage.toString('base64');
      return page.evaluate(async ({ imageBase64, portalBounds }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${imageBase64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (context === null) return { greenPixels: 0 };
        context.drawImage(image, 0, 0);
        const x = Math.max(0, Math.floor(portalBounds.x));
        const y = Math.max(0, Math.floor(portalBounds.y));
        const width = Math.max(0, Math.min(Math.ceil(portalBounds.width), canvas.width - x));
        const height = Math.max(0, Math.min(Math.ceil(portalBounds.height), canvas.height - y));
        const pixels = context.getImageData(x, y, width, height).data;
        let greenPixels = 0;
        for (let offset = 0; offset < pixels.length; offset += 4) {
          const red = pixels[offset]!;
          const green = pixels[offset + 1]!;
          const blue = pixels[offset + 2]!;
          const alpha = pixels[offset + 3]!;
          if (red < 80 && green > 150 && blue < 150 && alpha > 200) greenPixels += 1;
        }
        return { greenPixels };
      }, { imageBase64: encoded, portalBounds: bounds });
    },
    ready: (evidence) => evidence.greenPixels >= 5_000,
  });
  assert.equal(
    await page.getByText(`Preview function/resource bridge: ${FUNCTION_RESOURCE_VALUE}`, { exact: true }).count(),
    0,
    'The function/resource result escaped the closed Capsule guest DOM boundary.',
  );
}

async function assertDraftPreviewTitlebar(
  page: Page,
  label: string,
  nodeId: string,
): Promise<void> {
  const titlebar = page.locator('[data-vibecanvas-widget-titlebar]').filter({
    has: page.getByText('Preview: Browser Acceptance Widget', { exact: true }),
  });
  await titlebar.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  assert.equal(await titlebar.count(), 1, `${label} rendered more than one Preview titlebar.`);
  assert.equal(
    await titlebar.locator('[data-omnidraw-widget-extension-titlebar]').count(),
    0,
    `${label} retained the overlapping extension titlebar surface.`,
  );
  const title = titlebar.getByText('Preview: Browser Acceptance Widget', { exact: true });
  assert.equal(await title.count(), 1, `${label} did not render exactly one Preview title.`);
  const actions = titlebar.locator(
    '[data-widget-control-part="header-item:preview-actions"]'
      + '[aria-label="Preview actions"][aria-haspopup="menu"]',
  );
  assert.equal(await actions.count(), 1, `${label} did not render one compact Preview actions control.`);
  assert.equal((await actions.innerText()).trim(), '•••', `${label} did not retain the compact Preview action glyph.`);
  const [titlebarBounds, titleBounds, actionBounds] = await Promise.all([
    titlebar.boundingBox(),
    title.boundingBox(),
    actions.boundingBox(),
  ]);
  assert.ok(titlebarBounds !== null && titleBounds !== null && actionBounds !== null, `${label} titlebar geometry is unavailable.`);
  const tolerance = 1;
  assert.ok(titleBounds.x >= titlebarBounds.x - tolerance, `${label} title escaped the titlebar left edge.`);
  assert.ok(titleBounds.x + titleBounds.width <= titlebarBounds.x + titlebarBounds.width + tolerance, `${label} title escaped the titlebar right edge.`);
  assert.ok(actionBounds.x >= titlebarBounds.x - tolerance, `${label} action escaped the titlebar left edge.`);
  assert.ok(actionBounds.x + actionBounds.width <= titlebarBounds.x + titlebarBounds.width + tolerance, `${label} action escaped the titlebar right edge.`);
  assert.ok(
    titleBounds.x + titleBounds.width <= actionBounds.x + tolerance,
    `${label} Preview title overlaps its compact action (${JSON.stringify({ actionBounds, titleBounds })}).`,
  );
  await actions.click();
  for (const action of ['Reload', 'Rebuild', 'Build and Publish', 'Remove']) {
    const menuItem = page.getByRole('menuitem', { name: action, exact: true });
    await menuItem.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
    assert.equal(await menuItem.count(), 1, `${label} menu did not expose exactly one '${action}' action.`);
  }
  const previewOpenBeforeReload = (await readRpcRequests(page, 'widget.preview.open')).length;
  const rebuildBeforeReload = (await readRpcRequests(page, 'widget.preview.rebuildDraft')).length;
  await page.getByRole('menuitem', { name: 'Reload', exact: true }).click();
  await Bun.sleep(250);
  if ((await readRpcRequests(page, 'widget.preview.open')).length === previewOpenBeforeReload) {
    await actions.click();
    const reload = page.getByRole('menuitem', { name: 'Reload', exact: true });
    await reload.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
    await reload.click();
  }
  await waitForSuccessfulRpcRequest({
    afterCount: previewOpenBeforeReload,
    label: `${label} native Reload action`,
    page,
    path: 'widget.preview.open',
    predicate: (request) => record(request.input).elementId === nodeId,
  });
  assert.equal(
    (await readRpcRequests(page, 'widget.preview.rebuildDraft')).length,
    rebuildBeforeReload,
    `${label} native Reload action invoked the explicit rebuild operation.`,
  );
}

function summarizeTransport(transport: TTransportEvidence): unknown {
  return transport.rpcConnections.map((connection) => ({
    actualMessagesAfterNewerOpen: connection.actualMessagesAfterNewerOpen,
    closeCode: connection.closeCode,
    id: connection.id,
    incomingFrameCount: connection.incomingFrameCount,
    openSequence: connection.openSequence,
    outgoing: connection.outgoingFrames.map((frame) => {
      try {
        const value = JSON.parse(frame) as {
          _tag?: string;
          payload?: { path?: string };
          requestId?: number;
        };
        return value.payload?.path ?? `${value._tag ?? 'frame'}:${value.requestId ?? ''}`;
      } catch {
        return 'unparseable';
      }
    }),
  }));
}

async function seedDraftWidget(home: string): Promise<string> {
  const widgetRoot = join(home, 'widgets/drafts/browser-acceptance');
  const unbuiltWidgetRoot = join(home, 'widgets/drafts/browser-unbuilt');
  const canvasWidgetRoot = join(home, 'widgets/drafts/browser-canvas-2d');
  const webglWidgetRoot = join(home, 'widgets/drafts/browser-webgl');
  const functionResourceRoot = join(home, `widgets/drafts/${FUNCTION_RESOURCE_WIDGET_KEY}`);
  const toolsRoot = join(home, 'browser-acceptance-tools');
  const sdkCli = join(ROOT, 'packages/sdk/dist/cli.js');
  const viteModuleUrl = new URL(
    '../dist/node/index.js',
    `file://${VITE_BIN}`,
  ).href;
  const sdkWidgetModuleUrl = new URL(
    'src/widget.ts',
    `file://${join(ROOT, 'packages/sdk/')}`,
  ).href;
  const threeModuleRoot = join(ROOT, 'node_modules/.bun/three@0.185.1/node_modules/three');
  const viteWrapperSource = [
    '#!/usr/bin/env node',
    'const { readFile, writeFile } = await import("node:fs/promises");',
    'const args = process.argv.slice(2);',
    'const configPath = args[args.indexOf("--config") + 1];',
    'if (!configPath) throw new Error("Missing portable Vite config path.");',
    'let source = await readFile(configPath, "utf8");',
    `source = source.replace('from "vite"', 'from ${JSON.stringify(viteModuleUrl)}');`,
    'await writeFile(configPath, source);',
    'const bridgePath = new URL("../__omnidraw_guest_bridge__.mjs", `file://${configPath}`).pathname;',
    'let bridge = await readFile(bridgePath, "utf8");',
    `bridge = bridge.replace("from '@omnidraw/sdk/widget'", 'from ${JSON.stringify(sdkWidgetModuleUrl)}');`,
    `bridge = bridge.replace("from '@omnidraw/sdk'", 'from ${JSON.stringify(sdkWidgetModuleUrl)}');`,
    'await writeFile(bridgePath, bridge);',
    `await import(${JSON.stringify(VITE_BIN)});`,
    '',
  ].join('\n');
  await mkdir(join(widgetRoot, 'ui'), { recursive: true, mode: 0o700 });
  await mkdir(join(widgetRoot, 'node_modules/vite/bin'), { recursive: true, mode: 0o700 });
  await mkdir(join(unbuiltWidgetRoot, 'ui'), { recursive: true, mode: 0o700 });
  await mkdir(join(functionResourceRoot, 'ui'), { recursive: true, mode: 0o700 });
  await mkdir(join(functionResourceRoot, 'server'), { recursive: true, mode: 0o700 });
  for (const root of [canvasWidgetRoot, webglWidgetRoot]) {
    await mkdir(join(root, 'ui'), { recursive: true, mode: 0o700 });
    await mkdir(join(root, 'node_modules/vite/bin'), { recursive: true, mode: 0o700 });
  }
  await symlink(threeModuleRoot, join(webglWidgetRoot, 'node_modules/three'), 'dir');
  await mkdir(toolsRoot, { recursive: true, mode: 0o700 });
  const manifest = {
    $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
    schemaVersion: 1,
    name: 'Browser Acceptance Widget',
    slug: 'browser-acceptance',
    description: 'A deterministic draft used only by the live browser suite.',
    tool: {
      label: 'Browser Acceptance Widget',
      group: 'acceptance',
      priority: 0,
    },
    ui: {
      runtime: 'capsule',
      entry: 'ui/main.ts',
      apis: ['DOM'],
    },
  } as const;
  const unbuiltManifest = {
    ...manifest,
    name: 'Browser Unbuilt Widget',
    slug: 'browser-unbuilt',
    description: 'A valid lockfile-only draft used to prove persistent pre-guest failure UI.',
    tool: {
      ...manifest.tool,
      label: 'Browser Unbuilt Widget',
      priority: 1,
    },
  } as const;
  const profileManifests = [{
    root: canvasWidgetRoot,
    manifest: {
      ...manifest,
      name: 'Browser Canvas 2D Widget',
      slug: 'browser-canvas-2d',
      description: 'A deterministic Canvas 2D first-frame qualification fixture.',
      tool: { ...manifest.tool, label: 'Browser Canvas 2D Widget', priority: 2 },
      ui: { ...manifest.ui, apis: ['DOM', 'CANVAS_2D'] },
    },
    source: [
      'const canvas = document.createElement("canvas");',
      'canvas.width = 128;',
      'canvas.height = 96;',
      'document.body.append(canvas);',
      'const context = canvas.getContext("2d");',
      'if (context === null) throw new Error("Canvas 2D is unavailable");',
      'context.fillStyle = "#08110d";',
      'context.fillRect(0, 0, 128, 96);',
      'context.fillStyle = "#35e184";',
      'context.fillRect(18, 18, 92, 60);',
      'requestAnimationFrame(() => {',
      '  context.fillStyle = "#050505";',
      '  context.fillRect(48, 38, 32, 20);',
      '});',
      '',
    ].join('\n'),
  }, {
    root: webglWidgetRoot,
    manifest: {
      ...manifest,
      name: 'Browser WebGL Widget',
      slug: 'browser-webgl',
      description: 'A deterministic indexed RawShaderMaterial WebGL qualification fixture.',
      tool: { ...manifest.tool, label: 'Browser WebGL Widget', priority: 3 },
      ui: { ...manifest.ui, apis: ['DOM', 'WEBGL'] },
    },
    source: [
      'import * as THREE from "three";',
      'const canvas = document.createElement("canvas");',
      'canvas.width = 128;',
      'canvas.height = 96;',
      'document.body.append(canvas);',
      'const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false });',
      'renderer.setSize(128, 96, false);',
      'renderer.setClearColor(0x050505, 1);',
      'const geometry = new THREE.BufferGeometry();',
      'geometry.setAttribute("position", new THREE.Float32BufferAttribute([-0.8, -0.7, 0, 0.8, -0.7, 0, 0, 0.8, 0], 3));',
      'geometry.setIndex([0, 1, 2]);',
      'const material = new THREE.RawShaderMaterial({',
      '  vertexShader: "precision highp float; attribute vec3 position; uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",',
      '  fragmentShader: "precision highp float; void main(){ gl_FragColor = vec4(0.95, 0.05, 0.55, 1.0); }",',
      '  depthTest: false,',
      '  depthWrite: false,',
      '});',
      'const scene = new THREE.Scene();',
      'scene.add(new THREE.Mesh(geometry, material));',
      'renderer.render(scene, new THREE.Camera());',
      '',
    ].join('\n'),
    dependencies: { three: '0.185.1' },
  }] as const;
  const packageJson = (name: string, dependencies: Readonly<Record<string, string>> = {}) => `${JSON.stringify({
    name,
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: { build: 'omnidraw-widget build .' },
    dependencies,
    devDependencies: { vite: '8.1.4' },
  }, null, 2)}\n`;
  const packageLock = (name: string, dependencies: Readonly<Record<string, string>> = {}) => `${JSON.stringify({
    name,
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name,
        version: '1.0.0',
        ...(Object.keys(dependencies).length === 0 ? {} : { dependencies }),
        devDependencies: { vite: '8.1.4' },
      },
    },
  }, null, 2)}\n`;
  await Promise.all([
    writeFile(join(widgetRoot, 'omnidraw.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 }),
    writeFile(join(widgetRoot, 'ui/main.ts'), [
      'const root = document.createElement("section");',
      'root.setAttribute("data-browser-acceptance-widget", "mounted");',
      'root.textContent = "Browser Acceptance Widget mounted";',
      'document.body.append(root);',
      '',
    ].join('\n'), { mode: 0o600 }),
    writeFile(join(widgetRoot, 'package.json'), `${JSON.stringify({
      name: 'browser-acceptance',
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts: { build: 'omnidraw-widget build .' },
      devDependencies: { vite: '8.1.4' },
    }, null, 2)}\n`, { mode: 0o600 }),
    writeFile(join(widgetRoot, 'package-lock.json'), `${JSON.stringify({
      name: 'browser-acceptance',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: 'browser-acceptance',
          version: '1.0.0',
          devDependencies: { vite: '8.1.4' },
        },
      },
    }, null, 2)}\n`, { mode: 0o600 }),
    writeFile(join(unbuiltWidgetRoot, 'omnidraw.json'), `${JSON.stringify(unbuiltManifest, null, 2)}\n`, { mode: 0o600 }),
    writeFile(join(unbuiltWidgetRoot, 'ui/main.ts'), [
      'const root = document.createElement("section");',
      'root.setAttribute("data-browser-unbuilt-widget", "mounted");',
      'root.textContent = "This guest must not mount before an accepted build.";',
      'document.body.append(root);',
      '',
    ].join('\n'), { mode: 0o600 }),
    writeFile(join(unbuiltWidgetRoot, 'package.json'), `${JSON.stringify({
      name: 'browser-unbuilt',
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts: { build: 'omnidraw-widget build .' },
      devDependencies: { vite: '8.1.4' },
    }, null, 2)}\n`, { mode: 0o600 }),
    writeFile(join(unbuiltWidgetRoot, 'package-lock.json'), `${JSON.stringify({
      name: 'browser-unbuilt',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: 'browser-unbuilt',
          version: '1.0.0',
          devDependencies: { vite: '8.1.4' },
        },
      },
    }, null, 2)}\n`, { mode: 0o600 }),
    writeFile(
      join(functionResourceRoot, 'omnidraw.json'),
      `${JSON.stringify(functionResourceManifest(), null, 2)}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      join(functionResourceRoot, 'ui/main.ts'),
      FUNCTION_RESOURCE_UI_SOURCE,
      { mode: 0o600 },
    ),
    writeFile(
      join(functionResourceRoot, 'server/main.server.ts'),
      FUNCTION_RESOURCE_SERVER_SOURCE,
      { mode: 0o600 },
    ),
    writeFile(join(functionResourceRoot, 'package.json'), `${JSON.stringify({
      name: FUNCTION_RESOURCE_WIDGET_KEY,
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts: { build: 'omnidraw-widget build .' },
      dependencies: { '@omnidraw/sdk': SDK_VERSION },
      devDependencies: { vite: '8.1.4' },
    }, null, 2)}\n`, { mode: 0o600 }),
    writeFile(join(functionResourceRoot, 'package-lock.json'), `${JSON.stringify({
      name: FUNCTION_RESOURCE_WIDGET_KEY,
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: FUNCTION_RESOURCE_WIDGET_KEY,
          version: '1.0.0',
          dependencies: { '@omnidraw/sdk': SDK_VERSION },
          devDependencies: { vite: '8.1.4' },
        },
      },
    }, null, 2)}\n`, { mode: 0o600 }),
    writeFile(
      join(widgetRoot, 'node_modules/vite/bin/vite.js'),
      viteWrapperSource,
      { mode: 0o700 },
    ),
    ...profileManifests.flatMap((fixture) => {
      const dependencies = 'dependencies' in fixture ? fixture.dependencies : {};
      return [
        writeFile(join(fixture.root, 'omnidraw.json'), `${JSON.stringify(fixture.manifest, null, 2)}\n`, { mode: 0o600 }),
        writeFile(join(fixture.root, 'ui/main.ts'), fixture.source, { mode: 0o600 }),
        writeFile(join(fixture.root, 'package.json'), packageJson(fixture.manifest.slug, dependencies), { mode: 0o600 }),
        writeFile(join(fixture.root, 'package-lock.json'), packageLock(fixture.manifest.slug, dependencies), { mode: 0o600 }),
        writeFile(join(fixture.root, 'node_modules/vite/bin/vite.js'), viteWrapperSource, { mode: 0o700 }),
      ];
    }),
    writeFile(join(toolsRoot, 'npm'), [
      '#!/usr/bin/env node',
      'const { spawnSync } = await import("node:child_process");',
      'const { mkdir, readFile, symlink, writeFile } = await import("node:fs/promises");',
      'const { join } = await import("node:path");',
      'const args = process.argv.slice(2);',
      'if (args[0] === "--version") { process.stdout.write("10.0.0\\n"); process.exit(0); }',
      'if (args[0] === "ci") {',
      '  const viteBin = join(process.cwd(), "node_modules/vite/bin/vite.js");',
      '  await mkdir(join(process.cwd(), "node_modules/vite/bin"), { recursive: true });',
      `  await writeFile(viteBin, ${JSON.stringify(viteWrapperSource)}, { mode: 0o700 });`,
      '  await mkdir(join(process.cwd(), "node_modules/@omnidraw"), { recursive: true });',
      `  await symlink(${JSON.stringify(SDK_ROOT)}, join(process.cwd(), "node_modules/@omnidraw/sdk"), "dir").catch((error) => { if (error.code !== "EEXIST") throw error; });`,
      '  const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));',
      '  if (packageJson.dependencies?.three === "0.185.1") {',
      `    await symlink(${JSON.stringify(threeModuleRoot)}, join(process.cwd(), "node_modules/three"), "dir").catch((error) => { if (error.code !== "EEXIST") throw error; });`,
      '  }',
      '  process.exit(0);',
      '}',
      'if (args[0] === "run" && args[1] === "build") {',
      `  const result = spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(sdkCli)}, "build", "."], {`,
      '    cwd: process.cwd(), env: process.env, stdio: "inherit",',
      '  });',
      '  process.exit(result.status ?? 1);',
      '}',
      'process.stderr.write(`Unexpected browser acceptance npm invocation: ${args.join(" ")}\\n`);',
      'process.exit(2);',
      '',
    ].join('\n'), { mode: 0o700 }),
  ]);

  const build = Bun.spawn([process.execPath, sdkCli, 'build', '.'], {
    cwd: widgetRoot,
    env: process.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    build.exited,
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
  ]);
  assert.equal(exitCode, 0, `Could not prebuild the deterministic Preview fixture.\n${stdout}\n${stderr}`);
  for (const fixture of profileManifests) {
    const fixtureBuild = Bun.spawn([process.execPath, sdkCli, 'build', '.'], {
      cwd: fixture.root,
      env: process.env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [fixtureExitCode, fixtureStdout, fixtureStderr] = await Promise.all([
      fixtureBuild.exited,
      new Response(fixtureBuild.stdout).text(),
      new Response(fixtureBuild.stderr).text(),
    ]);
    assert.equal(
      fixtureExitCode,
      0,
      `Could not prebuild ${fixture.manifest.slug}.\n${fixtureStdout}\n${fixtureStderr}`,
    );
  }
  return toolsRoot;
}

async function bindFunctionResourceDraft(home: string, resourceId: string): Promise<void> {
  await writeFile(
    join(home, `widgets/drafts/${FUNCTION_RESOURCE_WIDGET_KEY}/omnidraw.json`),
    `${JSON.stringify(functionResourceManifest(resourceId), null, 2)}\n`,
    { mode: 0o600 },
  );
}

async function installWebSocketEvidence(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type TConnectionRecord = {
      actualMessagesAfterNewerOpen: number;
      closeCode: number | null;
      closed: boolean;
      id: number;
      incoming: string[];
      openSequence: number | null;
      opened: boolean;
      outgoing: string[];
      outgoingFrameCount: number;
      socket: WebSocket;
      url: string;
    };

    const NativeWebSocket = window.WebSocket;
    const records: TConnectionRecord[] = [];
    let nextId = 1;
    let rpcOpenCount = 0;

    const isRpc = (url: string) => {
      try {
        return new URL(url, window.location.href).pathname === '/rpc';
      } catch {
        return false;
      }
    };

    const TrackedWebSocket = new Proxy(NativeWebSocket, {
      construct(target, args) {
        const socket = Reflect.construct(target, args, target) as WebSocket;
        const record: TConnectionRecord = {
          actualMessagesAfterNewerOpen: 0,
          closeCode: null,
          closed: false,
          id: nextId++,
          incoming: [],
          openSequence: null,
          opened: false,
          outgoing: [],
          outgoingFrameCount: 0,
          socket,
          url: socket.url,
        };
        records.push(record);
        const nativeSend = socket.send.bind(socket);
        socket.send = ((data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
          record.outgoingFrameCount += 1;
          if (typeof data === 'string') record.outgoing.push(data);
          nativeSend(data as Parameters<WebSocket['send']>[0]);
        }) as WebSocket['send'];
        socket.addEventListener('open', () => {
          record.opened = true;
          if (isRpc(record.url)) record.openSequence = ++rpcOpenCount;
        });
        socket.addEventListener('message', (event) => {
          if (!isRpc(record.url)) return;
          if (typeof event.data === 'string') record.incoming.push(event.data);
          const newestOpen = records.reduce((latest, candidate) => (
            isRpc(candidate.url) ? Math.max(latest, candidate.openSequence ?? 0) : latest
          ), 0);
          if ((record.openSequence ?? 0) < newestOpen) {
            record.actualMessagesAfterNewerOpen += 1;
          }
        });
        socket.addEventListener('close', (event) => {
          record.closed = true;
          record.closeCode = event.code;
        });
        return socket;
      },
    });

    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      value: TrackedWebSocket,
      writable: true,
    });

    const harness = {
      forceRpcDisconnect() {
        const active = records.findLast((record) => (
          isRpc(record.url) && record.socket.readyState === NativeWebSocket.OPEN
        ));
        if (!active) throw new Error('No open native /rpc WebSocket is available to disconnect.');
        active.socket.close(4001, 'browser-acceptance-reconnect');
        return {
          id: active.id,
          incomingFrameCount: active.incoming.length,
          openSequence: active.openSequence,
        };
      },
      snapshot(): TTransportEvidence {
        return {
          rpcConnections: records.filter((record) => isRpc(record.url)).map((record) => ({
            actualMessagesAfterNewerOpen: record.actualMessagesAfterNewerOpen,
            closeCode: record.closeCode,
            closed: record.closed,
            id: record.id,
            incomingFrameCount: record.incoming.length,
            incomingFrames: record.incoming,
            openSequence: record.openSequence,
            opened: record.opened,
            outgoingFrames: record.outgoing,
            outgoingFrameCount: record.outgoingFrameCount,
            url: record.url,
          })),
          rpcOpenCount,
        };
      },
    };
    Object.defineProperty(window, '__omnidrawBrowserAcceptance', {
      configurable: false,
      value: harness,
      writable: false,
    });
  });
}

async function waitForRpcConnection(page: Page): Promise<TTransportEvidence> {
  return await waitForBrowserState({
    label: 'the frontend native RPC connection',
    read: () => page.evaluate(() => (
      (window as unknown as {
        __omnidrawBrowserAcceptance: { snapshot(): TTransportEvidence };
      }).__omnidrawBrowserAcceptance.snapshot()
    )),
    ready: (state) => state.rpcConnections.some((connection) => (
      connection.opened && !connection.closed && connection.incomingFrameCount > 0
    )),
  });
}

async function readRpcRequests(page: Page, path: string): Promise<readonly TRpcWireRequest[]> {
  return await page.evaluate((selectedPath) => {
    const transport = (window as unknown as {
      __omnidrawBrowserAcceptance: { snapshot(): TTransportEvidence };
    }).__omnidrawBrowserAcceptance.snapshot();
    return transport.rpcConnections.flatMap((connection) => {
      const exits = new Map<number, Readonly<{ _tag?: string; cause?: unknown; value?: unknown }>>();
      for (const chunk of connection.incomingFrames) {
        for (const frame of chunk.split('\n')) {
          if (!frame.trim()) continue;
          try {
            const value = JSON.parse(frame) as {
              _tag?: string;
              exit?: Readonly<{ _tag?: string; cause?: unknown; value?: unknown }>;
              requestId?: number;
            };
            if (value._tag === 'Exit' && typeof value.requestId === 'number' && value.exit !== undefined) {
              exits.set(value.requestId, value.exit);
            }
          } catch {
            // Invalid frames remain visible to the transport-level parse checks.
          }
        }
      }
      return connection.outgoingFrames.flatMap((chunk) => chunk.split('\n')).flatMap((frame) => {
        if (!frame.trim()) return [];
        try {
          const value = JSON.parse(frame) as {
            _tag?: string;
            id?: number;
            payload?: { input?: unknown; path?: string };
          };
          if (
            value._tag !== 'Request'
            || typeof value.id !== 'number'
            || value.payload?.path !== selectedPath
          ) return [];
          const exit = exits.get(value.id);
          return [{
            complete: exit !== undefined,
            connectionId: connection.id,
            exit: exit ?? null,
            input: value.payload.input,
            path: selectedPath,
            requestId: value.id,
          }];
        } catch {
          return [];
        }
      });
    });
  }, path);
}

async function waitForSuccessfulRpcRequest(args: Readonly<{
  afterCount: number;
  label: string;
  page: Page;
  path: string;
  predicate?(request: TRpcWireRequest): boolean;
}>): Promise<TRpcWireRequest> {
  const requests = await waitForBrowserState<readonly TRpcWireRequest[]>({
    label: args.label,
    read: () => readRpcRequests(args.page, args.path),
    // A superseded widget mount can finish its request with Failure before the
    // replacement mount completes the same operation successfully.
    ready: (values) => values.slice(args.afterCount).some((request) => (
      request.complete
      && request.exit?._tag === 'Success'
      && (args.predicate?.(request) ?? true)
    )),
  });
  const request = requests.slice(args.afterCount).findLast((candidate) => (
    candidate.complete
    && candidate.exit?._tag === 'Success'
    && (args.predicate?.(candidate) ?? true)
  ));
  assert.ok(request !== undefined, `No completed ${args.path} request matched ${args.label}.`);
  assert.equal(
    request.exit?._tag,
    'Success',
    `${args.path} failed: ${JSON.stringify(request.exit)}`,
  );
  return request;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function canvasCommandWidgetNode(request: TRpcWireRequest): Readonly<Record<string, unknown>> | null {
  const changedItems = Array.isArray(record(request.exit?.value).changedItems)
    ? record(request.exit?.value).changedItems as readonly unknown[]
    : [];
  for (const candidate of changedItems) {
    const item = record(record(candidate).item);
    if (item.kind === 'widget-frame') return item;
  }
  const input = record(request.input);
  const operations = Array.isArray(input.operations) ? input.operations : [];
  for (const candidate of operations) {
    const operation = record(candidate);
    if (operation.type !== 'insert' && operation.type !== 'replace') continue;
    const item = record(operation.item);
    if (item.kind === 'widget-frame') return item;
  }
  return null;
}

function canvasCommandNode(
  request: TRpcWireRequest,
  predicate: (node: Readonly<Record<string, unknown>>) => boolean,
): Readonly<Record<string, unknown>> | null {
  const changedItems = Array.isArray(record(request.exit?.value).changedItems)
    ? record(request.exit?.value).changedItems as readonly unknown[]
    : [];
  for (const candidate of changedItems) {
    const item = record(record(candidate).item);
    if (predicate(item)) return item;
  }
  const input = record(request.input);
  const operations = Array.isArray(input.operations) ? input.operations : [];
  for (const candidate of operations) {
    const operation = record(candidate);
    if (operation.type !== 'insert' && operation.type !== 'replace') continue;
    const item = record(operation.item);
    if (predicate(item)) return item;
  }
  return null;
}

function canvasCommandDeletes(request: TRpcWireRequest, nodeId: string): boolean {
  const input = record(request.input);
  const operations = Array.isArray(input.operations) ? input.operations : [];
  return operations.some((candidate) => {
    const operation = record(candidate);
    return operation.type === 'delete' && operation.itemId === nodeId;
  });
}

function canvasWidgetExtension(node: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const extensions = record(node.extensions);
  return record(extensions['omnidraw:widget']);
}

async function assertNoHandledErrorAlerts(page: Page, context: string): Promise<void> {
  const alerts = await page.locator('[role="alert"]:visible').allTextContents();
  const errors = alerts.map((value) => value.trim()).filter((value) => (
    /(?:could not|failed|failure|invalid|expected never|internal server error)/iu.test(value)
  ));
  assert.deepEqual(errors, [], `${context} exposed handled UI errors:\n${errors.join('\n')}`);
}

async function forceDisconnectAndWaitForReconnect(page: Page): Promise<Readonly<{
  retiredConnectionId: number;
  transport: TTransportEvidence;
}>> {
  const initialTransport = await waitForRpcConnection(page);
  const initialOpenCount = initialTransport.rpcOpenCount;

  const retired = await page.evaluate(() => (
    (window as unknown as {
      __omnidrawBrowserAcceptance: {
        forceRpcDisconnect(): Readonly<{ id: number; incomingFrameCount: number; openSequence: number | null }>;
      };
    }).__omnidrawBrowserAcceptance.forceRpcDisconnect()
  ));
  assert.ok(retired.openSequence !== null, 'The disconnected native socket never reached open state.');
  assert.ok(retired.incomingFrameCount > 0, 'The retired RPC generation had no server frames to fence.');

  const transport = await waitForBrowserState<TTransportEvidence>({
    label: 'a replacement native frontend RPC connection',
    read: () => page.evaluate(() => (
      (window as unknown as {
        __omnidrawBrowserAcceptance: { snapshot(): TTransportEvidence };
      }).__omnidrawBrowserAcceptance.snapshot()
    )),
    ready: (evidence) => evidence.rpcOpenCount > initialOpenCount
      && evidence.rpcConnections.some((connection) => (
        (connection.openSequence ?? 0) > initialOpenCount
        && connection.opened
        && !connection.closed
        && connection.incomingFrameCount > 0
      )),
  });
  await page.waitForTimeout(1_000);
  console.log('[browser:live] reconnect evidence', JSON.stringify(summarizeTransport(transport)));
  assert.ok(
    transport.rpcOpenCount > initialOpenCount,
    'The browser did not open a replacement native /rpc WebSocket.',
  );

  return Object.freeze({
    retiredConnectionId: retired.id,
    transport,
  });
}

async function createCanvas(page: Page, name: string): Promise<TCreatedCanvas> {
  await page.getByRole('button', { name: 'Add canvas' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Your Canvas' });
  await dialog.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  await dialog.getByLabel('Canvas Title').fill(name);
  await dialog.getByRole('button', { name: 'Create Canvas' }).click();
  await page.getByText(name, { exact: true }).first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  await page.waitForURL((url) => /^\/c\/[^/]+$/.test(url.pathname), { timeout: ROUTE_TIMEOUT_MS });
  return Object.freeze({
    id: new URL(page.url()).pathname.split('/').at(-1) ?? '',
    name,
  });
}

async function exerciseDurableArrowConnections(page: Page): Promise<Readonly<{
  arrow: Readonly<Record<string, unknown>>;
  arrowId: string;
  canvasId: string;
}>> {
  const host = page.locator('.omnidraw-canvas-engine-host');
  await host.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  const bounds = await host.boundingBox();
  assert.ok(bounds !== null, 'The Arrow acceptance Canvas has no drawable bounds.');
  const canvasId = new URL(page.url()).pathname.split('/').at(-1) ?? '';
  assert.ok(canvasId.length > 0, 'The Arrow acceptance Canvas has no route identity.');

  const lineStart = {
    x: bounds.x + bounds.width * 0.18,
    y: bounds.y + bounds.height * 0.74,
  };
  const lineEnd = {
    x: bounds.x + bounds.width * 0.40,
    y: bounds.y + bounds.height * 0.82,
  };
  let before = (await readRpcRequests(page, 'canvas.execute')).length;
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.mouse.move(lineStart.x, lineStart.y);
  await page.mouse.down();
  await page.mouse.move(lineEnd.x, lineEnd.y, { steps: 6 });
  await page.mouse.up();
  const lineCommand = await waitForSuccessfulRpcRequest({
    afterCount: before,
    label: 'the disposable Line creation command',
    page,
    path: 'canvas.execute',
    predicate: (request) => canvasCommandNode(
      request,
      (node) => node.kind === 'connector' && record(node.endMarker).shape !== 'arrow',
    ) !== null,
  });
  const line = canvasCommandNode(
    lineCommand,
    (node) => node.kind === 'connector' && record(node.endMarker).shape !== 'arrow',
  );
  assert.ok(line !== null && typeof line.id === 'string', 'Line creation returned no connector.');
  before = (await readRpcRequests(page, 'canvas.execute')).length;
  await page.keyboard.press('Delete');
  await waitForSuccessfulRpcRequest({
    afterCount: before,
    label: 'the selected Line deletion command',
    page,
    path: 'canvas.execute',
    predicate: (request) => canvasCommandDeletes(request, line.id as string),
  });
  await assertNoHandledErrorAlerts(page, 'selected Line deletion');

  const disposableArrowStart = {
    x: bounds.x + bounds.width * 0.58,
    y: bounds.y + bounds.height * 0.78,
  };
  const disposableArrowEnd = {
    x: bounds.x + bounds.width * 0.76,
    y: bounds.y + bounds.height * 0.70,
  };
  before = (await readRpcRequests(page, 'canvas.execute')).length;
  await page.getByRole('button', { name: 'Arrow', exact: true }).click();
  await page.mouse.move(disposableArrowStart.x, disposableArrowStart.y);
  await page.mouse.down();
  await page.mouse.move(disposableArrowEnd.x, disposableArrowEnd.y, { steps: 6 });
  await page.mouse.up();
  const disposableArrowCommand = await waitForSuccessfulRpcRequest({
    afterCount: before,
    label: 'the disposable Arrow creation command',
    page,
    path: 'canvas.execute',
    predicate: (request) => canvasCommandNode(
      request,
      (node) => node.kind === 'connector' && record(node.endMarker).shape === 'arrow',
    ) !== null,
  });
  const disposableArrow = canvasCommandNode(
    disposableArrowCommand,
    (node) => node.kind === 'connector' && record(node.endMarker).shape === 'arrow',
  );
  assert.ok(
    disposableArrow !== null && typeof disposableArrow.id === 'string',
    'Disposable Arrow creation returned no connector.',
  );
  before = (await readRpcRequests(page, 'canvas.execute')).length;
  await page.keyboard.press('Delete');
  await waitForSuccessfulRpcRequest({
    afterCount: before,
    label: 'the selected Arrow deletion command',
    page,
    path: 'canvas.execute',
    predicate: (request) => canvasCommandDeletes(
      request,
      disposableArrow.id as string,
    ),
  });
  await assertNoHandledErrorAlerts(page, 'selected Arrow deletion');

  const drawRectangle = async (
    label: string,
    start: Readonly<{ x: number; y: number }>,
    end: Readonly<{ x: number; y: number }>,
  ): Promise<Readonly<Record<string, unknown>>> => {
    const before = (await readRpcRequests(page, 'canvas.execute')).length;
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    const command = await waitForSuccessfulRpcRequest({
      afterCount: before,
      label,
      page,
      path: 'canvas.execute',
      predicate: (request) => canvasCommandNode(request, (node) => node.kind === 'rect') !== null,
    });
    const node = canvasCommandNode(command, (candidate) => candidate.kind === 'rect');
    assert.ok(node !== null && typeof node.id === 'string', `${label} did not return its authored rectangle.`);
    return node;
  };

  const firstStart = {
    x: bounds.x + bounds.width * 0.58,
    y: bounds.y + bounds.height * 0.52,
  };
  const firstEnd = { x: firstStart.x + 140, y: firstStart.y + 90 };
  const firstCenter = {
    x: (firstStart.x + firstEnd.x) / 2,
    y: (firstStart.y + firstEnd.y) / 2,
  };
  const secondStart = {
    x: bounds.x + bounds.width * 0.25,
    y: bounds.y + bounds.height * 0.30,
  };
  const secondEnd = { x: secondStart.x + 120, y: secondStart.y + 80 };
  const secondCenter = {
    x: (secondStart.x + secondEnd.x) / 2,
    y: (secondStart.y + secondEnd.y) / 2,
  };
  const thirdStart = {
    x: bounds.x + bounds.width * 0.62,
    y: bounds.y + bounds.height * 0.24,
  };
  const thirdEnd = { x: thirdStart.x + 110, y: thirdStart.y + 70 };
  const thirdCenter = {
    x: (thirdStart.x + thirdEnd.x) / 2,
    y: (thirdStart.y + thirdEnd.y) / 2,
  };
  const first = await drawRectangle('the first Arrow target', firstStart, firstEnd);
  const second = await drawRectangle('the second Arrow target', secondStart, secondEnd);
  const third = await drawRectangle('the Arrow rebind target', thirdStart, thirdEnd);

  before = (await readRpcRequests(page, 'canvas.execute')).length;
  await page.getByRole('button', { name: 'Arrow', exact: true }).click();
  await page.mouse.move(secondCenter.x, secondCenter.y);
  await page.mouse.down();
  await page.mouse.move(firstCenter.x, firstCenter.y, { steps: 8 });
  await page.mouse.up();
  const createdCommand = await waitForSuccessfulRpcRequest({
    afterCount: before,
    label: 'the bound Arrow creation command',
    page,
    path: 'canvas.execute',
    predicate: (request) => canvasCommandNode(request, (node) => node.kind === 'connector') !== null,
  });
  const createdArrow = canvasCommandNode(createdCommand, (node) => node.kind === 'connector');
  assert.ok(createdArrow !== null && typeof createdArrow.id === 'string', 'Arrow creation returned no connector.');
  const arrowId = createdArrow.id;
  const assertInsideEndpoint = (
    endpoint: unknown,
    expectedNodeId: unknown,
    label: string,
  ) => {
    const value = record(endpoint);
    const attachment = record(value.attachment);
    const fixedPoint = record(attachment.fixedPoint);
    assert.equal(value.type, 'node', `${label} is not node-bound.`);
    assert.equal(value.nodeId, expectedNodeId, `${label} bound to the wrong target.`);
    assert.equal(value.anchor, 'auto', `${label} did not use the auto anchor.`);
    assert.equal(attachment.mode, 'inside', `${label} did not retain inside semantics.`);
    assert.ok(Math.abs(Number(fixedPoint.x) - 0.5) < 0.000_01, `${label} x was not target-relative center.`);
    assert.ok(Math.abs(Number(fixedPoint.y) - 0.5) < 0.000_01, `${label} y was not target-relative center.`);
  };
  assertInsideEndpoint(createdArrow.from, second.id, 'Created Arrow tail');
  assertInsideEndpoint(createdArrow.to, first.id, 'Created Arrow head');
  assert.equal(record(createdArrow.endMarker).shape, 'arrow');

  before = (await readRpcRequests(page, 'canvas.execute')).length;
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const arrowMidpoint = {
    x: (secondCenter.x + firstCenter.x) / 2,
    y: (secondCenter.y + firstCenter.y) / 2,
  };
  await page.mouse.dblclick(arrowMidpoint.x, arrowMidpoint.y, { delay: 70 });
  await page.mouse.move(firstCenter.x, firstCenter.y);
  await page.mouse.down();
  await page.mouse.move(thirdCenter.x, thirdCenter.y, { steps: 8 });
  await page.mouse.up();
  const reboundCommand = await waitForSuccessfulRpcRequest({
    afterCount: before,
    label: 'the rebound Arrow head command',
    page,
    path: 'canvas.execute',
    predicate: (request) => {
      const node = canvasCommandNode(request, (candidate) => candidate.id === arrowId);
      return record(node?.to).nodeId === third.id;
    },
  });
  const reboundArrow = canvasCommandNode(
    reboundCommand,
    (candidate) => candidate.id === arrowId,
  );
  assert.ok(reboundArrow !== null, 'Arrow rebinding returned no authored connector.');
  assertInsideEndpoint(reboundArrow.from, second.id, 'Rebound Arrow tail');
  assertInsideEndpoint(reboundArrow.to, third.id, 'Rebound Arrow head');
  assert.equal(record(reboundArrow.endMarker).shape, 'arrow');

  const secondMoveHandle = { x: secondCenter.x - 34, y: secondCenter.y - 20 };
  before = (await readRpcRequests(page, 'canvas.execute')).length;
  await page.mouse.click(secondMoveHandle.x, secondMoveHandle.y);
  await page.mouse.move(secondMoveHandle.x, secondMoveHandle.y);
  await page.mouse.down();
  await page.mouse.move(secondMoveHandle.x + 48, secondMoveHandle.y + 24, { steps: 6 });
  await page.mouse.up();
  const movedTargetCommand = await waitForSuccessfulRpcRequest({
    afterCount: before,
    label: 'the moved Arrow source target',
    page,
    path: 'canvas.execute',
    predicate: (request) => canvasCommandNode(request, (node) => node.id === second.id) !== null,
  });
  const movedTarget = canvasCommandNode(movedTargetCommand, (node) => node.id === second.id);
  assert.ok(movedTarget !== null, 'Target movement returned no authored target.');
  assert.notDeepEqual(record(movedTarget.transform).position, record(second.transform).position);
  await assertNoHandledErrorAlerts(page, 'durable Arrow connection interactions');
  return Object.freeze({
    arrow: reboundArrow,
    arrowId,
    canvasId,
  });
}

async function assertArrowRecoveryAfterBackendRestart(
  page: Page,
  evidence: Readonly<{
    arrow: Readonly<Record<string, unknown>>;
    arrowId: string;
    canvasId: string;
  }>,
): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.omnidraw-canvas-host').waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  await waitForRpcConnection(page);
  const snapshotRequest = await waitForSuccessfulRpcRequest({
    afterCount: 0,
    label: 'the Canvas snapshot after Arrow backend recovery',
    page,
    path: 'canvas.snapshot',
    predicate: (request) => record(request.input).canvasId === evidence.canvasId,
  });
  const items = Array.isArray(record(snapshotRequest.exit?.value).items)
    ? record(snapshotRequest.exit?.value).items as readonly unknown[]
    : [];
  const recovered = items
    .map((item) => record(record(item).item))
    .find((item) => item.id === evidence.arrowId);
  assert.deepEqual(recovered, evidence.arrow, 'Backend restart/reload changed the exact durable Arrow endpoints.');
  await assertNoHandledErrorAlerts(page, 'Arrow backend restart recovery');
}

async function placeShortAiChatWidget(page: Page): Promise<Readonly<{
  sessionId: string;
  widgetId: string;
}>> {
  const knownRegressionMessages = [
    'Canvas failed to start:',
    'standard widget decoration is invalid',
    'transient projection failed',
    'Canvas event invalid',
    'itemRevision is 0',
  ] as const;
  const host = page.locator('.omnidraw-canvas-engine-host');
  await host.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  assert.equal(
    await host.count(),
    1,
    'Sidebar placement must target the one connected Canvas engine host.',
  );
  const canvasExecuteBefore = (await readRpcRequests(page, 'canvas.execute')).length;
  const connectBefore = (await readRpcRequests(page, 'agent.chat.connect')).length;
  await page.getByRole('button', { name: 'AI Chat', exact: true }).click();
  const bounds = await host.boundingBox();
  assert.ok(bounds !== null, 'The Canvas engine did not expose drawable bounds.');
  const start = {
    x: bounds.x + bounds.width * 0.55,
    y: bounds.y + bounds.height * 0.35,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 80, start.y + 60, { steps: 6 });
  await page.mouse.up();

  const evidence = await waitForBrowserState<Readonly<{ bodyText: string; shells: number }>>({
    label: 'the short-drag AI Chat portal to mount before reload',
    read: async () => ({
      bodyText: await page.locator('body').innerText(),
      shells: await page.locator('.omnidraw-ai-chat-shell').count(),
    }),
    ready: (value) => value.shells > 0 || knownRegressionMessages.some((message) => (
      value.bodyText.includes(message)
    )),
  });
  for (const message of knownRegressionMessages) {
    if (evidence.bodyText.includes(message)) {
      const transport = await page.evaluate(() => (
        (window as unknown as {
          __omnidrawBrowserAcceptance: { snapshot(): TTransportEvidence };
        }).__omnidrawBrowserAcceptance.snapshot()
      ));
      console.log('[browser:live] Canvas startup failure wire evidence', JSON.stringify(transport.rpcConnections.map((connection) => ({
        id: connection.id,
        incomingFrames: connection.incomingFrames,
        outgoingFrames: connection.outgoingFrames,
      }))));
    }
    assert.equal(
      evidence.bodyText.includes(message),
      false,
      `AI Chat placement surfaced the regression message '${message}'.`,
    );
  }
  assert.equal(evidence.shells, 1, 'AI Chat placement left a durable frame without its portal.');
  await page.locator('.omnidraw-ai-chat-shell').waitFor({
    state: 'visible',
    timeout: ROUTE_TIMEOUT_MS,
  });
  const command = await waitForSuccessfulRpcRequest({
    afterCount: canvasExecuteBefore,
    label: 'the accepted AI Chat Canvas command',
    page,
    path: 'canvas.execute',
    predicate: (request) => {
      const node = canvasCommandWidgetNode(request);
      const extension = node === null ? {} : canvasWidgetExtension(node);
      return extension.type === 'ui-widget' && extension.kind === 'ai-chat';
    },
  });
  const aiNode = canvasCommandWidgetNode(command);
  assert.ok(aiNode !== null, 'AI Chat command did not contain its widget-frame node.');
  assert.deepEqual(record(aiNode.size), { width: 240, height: 160 });
  const aiPosition = record(record(aiNode.transform).position);
  assert.ok(Number.isFinite(aiPosition.x), 'AI Chat x position is not finite.');
  assert.ok(Number.isFinite(aiPosition.y), 'AI Chat y position is not finite.');
  const connect = await waitForSuccessfulRpcRequest({
    afterCount: connectBefore,
    label: 'a successful agent.chat.connect response for the mounted widget',
    page,
    path: 'agent.chat.connect',
    predicate: (request) => record(request.input).widgetId === aiNode.id,
  });
  const connectInput = record(connect.input);
  assert.equal(connectInput.widgetId, aiNode.id);
  assert.equal(connectInput.canvasId, record(command.input).canvasId);
  assert.ok(typeof connectInput.sessionId === 'string' && connectInput.sessionId.length > 0);
  assert.deepEqual(record(connectInput.approvalPolicy), { mode: 'manual' });
  assert.equal(
    await page.getByText('Could not connect to AI chat', { exact: true }).count(),
    0,
    'The mounted AI Chat rendered a handled connection failure.',
  );
  assert.equal(
    await page.locator('[data-vibecanvas-widget-titlebar] button[aria-label="Settings"]').count(),
    1,
    'AI Chat must expose exactly one Settings titlebar action.',
  );
  await page.waitForTimeout(500);
  const settledBodyText = await page.locator('body').innerText();
  for (const message of knownRegressionMessages) {
    assert.equal(
      settledBodyText.includes(message),
      false,
      `AI Chat placement surfaced the delayed regression message '${message}'.`,
    );
  }
  await assertNoHandledErrorAlerts(page, 'AI Chat placement');
  return Object.freeze({
    sessionId: connectInput.sessionId as string,
    widgetId: aiNode.id as string,
  });
}

type TSelectionSurfaceEvidence = Readonly<{
  checksum: number;
  paintedPixels: number;
}>;

async function readSelectionSurfaceEvidence(page: Page): Promise<TSelectionSurfaceEvidence> {
  return await page.locator(
    'canvas[data-vibecanvas-surface="engine-transform-overlay"]',
  ).evaluate((surface: HTMLCanvasElement) => {
    const context = surface.getContext('2d', { willReadFrequently: true });
    if (context === null) {
      throw new Error('The Canvas transformer surface has no 2D context.');
    }
    const pixels = context.getImageData(0, 0, surface.width, surface.height).data;
    let checksum = 2_166_136_261;
    let paintedPixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const alpha = pixels[offset + 3]!;
      if (alpha === 0) continue;
      paintedPixels += 1;
      checksum = Math.imul(checksum ^ pixels[offset]!, 16_777_619) >>> 0;
      checksum = Math.imul(checksum ^ pixels[offset + 1]!, 16_777_619) >>> 0;
      checksum = Math.imul(checksum ^ pixels[offset + 2]!, 16_777_619) >>> 0;
      checksum = Math.imul(checksum ^ alpha, 16_777_619) >>> 0;
    }
    return { checksum, paintedPixels };
  });
}

async function exerciseSelectedCanvasDialogOcclusion(
  page: Page,
  widgetId: string,
): Promise<void> {
  const canvasRoot = page.locator('.omnidraw-canvas-host');
  const widgetShell = page.locator(
    `[data-vibecanvas-widget-shell="${widgetId}"]`,
  );
  const titlebar = widgetShell.locator('[data-vibecanvas-widget-titlebar]');
  await titlebar.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  await titlebar.click({ position: { x: 120, y: 15 } });

  const selected = await waitForBrowserState<TSelectionSurfaceEvidence>({
    label: 'the selected AI Chat transformer to paint',
    read: () => readSelectionSurfaceEvidence(page),
    ready: (evidence) => evidence.paintedPixels > 0,
  });
  await canvasRoot.evaluate((root) => {
    root.dataset.browserAcceptanceStackingRoot = 'selected-dialog';
  });

  await page.getByRole('button', { name: 'Add resource' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create resource' });
  await dialog.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });

  const modalCoverage = await page.evaluate(({ selectedWidgetId }) => {
    const root = document.querySelector<HTMLElement>('.omnidraw-canvas-host');
    const selection = document.querySelector<HTMLCanvasElement>(
      'canvas[data-vibecanvas-surface="engine-transform-overlay"]',
    );
    const widget = document.querySelector<HTMLElement>(
      `[data-vibecanvas-portal-id="omnidraw:widget:${selectedWidgetId}"]`,
    );
    const content = document.querySelector<HTMLElement>('[role="dialog"]');
    const overlay = content?.previousElementSibling;
    const rootBounds = root?.getBoundingClientRect();
    const left = Math.max(0, rootBounds?.left ?? 0);
    const right = Math.min(window.innerWidth, rootBounds?.right ?? 0);
    const top = Math.max(0, rootBounds?.top ?? 0);
    const bottom = Math.min(window.innerHeight, rootBounds?.bottom ?? 0);
    const x = left + Math.max(0, right - left) / 2;
    const y = top + Math.max(0, bottom - top) / 2;
    const hitStack = document.elementsFromPoint(x, y);
    const applicationBandIndex = hitStack.findIndex((element) => (
      element === overlay || (content?.contains(element) ?? false)
    ));
    const canvasBandIndex = hitStack.findIndex((element) => (
      root?.contains(element) ?? false
    ));
    return {
      canvasRootIdentity: root?.dataset.browserAcceptanceStackingRoot ?? null,
      contentZIndex: content === null ? null : getComputedStyle(content).zIndex,
      applicationPortalAboveCanvas: applicationBandIndex >= 0
        && (canvasBandIndex < 0 || applicationBandIndex < canvasBandIndex),
      overlayZIndex: overlay instanceof HTMLElement
        ? getComputedStyle(overlay).zIndex
        : null,
      rootContainsSelection: root?.contains(selection) ?? false,
      rootContainsWidget: root?.contains(widget) ?? false,
      rootIsolation: root === null ? null : getComputedStyle(root).isolation,
      selectionZIndex: selection === null ? null : getComputedStyle(selection).zIndex,
    };
  }, { selectedWidgetId: widgetId });
  assert.deepEqual(modalCoverage, {
    applicationPortalAboveCanvas: true,
    canvasRootIdentity: 'selected-dialog',
    contentZIndex: '50',
    overlayZIndex: '40',
    rootContainsSelection: true,
    rootContainsWidget: true,
    rootIsolation: 'isolate',
    selectionZIndex: '2147483647',
  });
  assert.deepEqual(
    await readSelectionSurfaceEvidence(page),
    selected,
    'Opening the application dialog changed or cleared the selected transformer.',
  );

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.waitFor({ state: 'hidden', timeout: ROUTE_TIMEOUT_MS });
  assert.equal(
    await canvasRoot.getAttribute('data-browser-acceptance-stacking-root'),
    'selected-dialog',
    'Closing the application dialog remounted the Canvas runtime root.',
  );
  assert.deepEqual(
    await readSelectionSurfaceEvidence(page),
    selected,
    'Closing the application dialog did not reveal the same selected transformer.',
  );
  await canvasRoot.evaluate((root) => {
    delete root.dataset.browserAcceptanceStackingRoot;
  });
}

function aiChatPayload(node: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return record(canvasWidgetExtension(node).payload);
}

async function showChatComposer(page: Page): Promise<void> {
  const actions = page.getByRole('button', { name: 'Chat actions' });
  if (await actions.isVisible()) return;
  const titlebarAction = page.getByRole('button', { name: /^(?:Settings|Back to chat)$/ }).first();
  await titlebarAction.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  await titlebarAction.click();
  await actions.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
}

async function persistAiChatStateAcrossReload(
  page: Page,
  initial: Readonly<{ sessionId: string; widgetId: string }>,
): Promise<Readonly<{ sessionId: string; widgetId: string }>> {
  await showChatComposer(page);
  const modelButton = page.locator('.omnidraw-ai-chat-composer__pill');
  await modelButton.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  let canvasExecuteBefore = (await readRpcRequests(page, 'canvas.execute')).length;
  assert.equal(
    await modelButton.isEnabled(),
    true,
    'The isolated deterministic model provider did not enable the AI Chat model picker.',
  );
  await modelButton.click();
  const modelSettings = page.getByRole('group', { name: 'AI model settings' });
  await modelSettings.getByRole('menuitem', { name: 'Browser Local', exact: true }).click();
  const models = page.getByRole('group', { name: 'AI models' })
    .locator('.omnidraw-ai-chat-composer__model-option');
  const selectedModel = models.filter({ hasText: FAKE_MODEL_NAME });
  await selectedModel.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  const renderedModelLabels = (await models.allInnerTexts()).map((label) => label.trim());
  const renderedCategoryLabels = (await modelSettings
    .getByRole('menuitem')
    .allInnerTexts()).map((label) => label.trim());
  assert.equal(
    await selectedModel.count(),
    1,
    `AI Chat did not list the deterministic browser model exactly once (categories: ${JSON.stringify(renderedCategoryLabels)}; models: ${JSON.stringify(renderedModelLabels)}).`,
  );
  const selectedModelName = (await selectedModel.locator('strong').innerText()).trim();
  assert.equal(selectedModelName, FAKE_MODEL_NAME);
  await selectedModel.click();
  const modelCommand = await waitForSuccessfulRpcRequest({
    afterCount: canvasExecuteBefore,
    label: 'the durable AI Chat model preference',
    page,
    path: 'canvas.execute',
    predicate: (request) => {
      const node = canvasCommandWidgetNode(request);
      const model = node === null ? {} : record(aiChatPayload(node).model);
      return node?.id === initial.widgetId
        && model.provider === FAKE_PROVIDER_ID
        && model.modelId === FAKE_MODEL_ID;
    },
  });
  const selectedModelIdentity = record(aiChatPayload(canvasCommandWidgetNode(modelCommand)!).model);
  assert.deepEqual(selectedModelIdentity, { provider: FAKE_PROVIDER_ID, modelId: FAKE_MODEL_ID });

  // A durable Canvas update can settle while the credential-free chat is back
  // on its settings view. Re-enter chat rather than force-clicking its hidden composer.
  await showChatComposer(page);
  await modelButton.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  canvasExecuteBefore = (await readRpcRequests(page, 'canvas.execute')).length;
  await modelButton.click();
  await page.getByRole('group', { name: 'AI model settings' })
    .getByRole('menuitem', { name: 'Thinking', exact: true })
    .click();
  await page.getByRole('group', { name: 'Thinking levels' })
    .getByRole('menuitemradio', { name: 'Xhigh', exact: true })
    .click();
  await waitForSuccessfulRpcRequest({
    afterCount: canvasExecuteBefore,
    label: 'the durable AI Chat thinking preference',
    page,
    path: 'canvas.execute',
    predicate: (request) => {
      const node = canvasCommandWidgetNode(request);
      const payload = node === null ? {} : aiChatPayload(node);
      return node?.id === initial.widgetId
        && payload.thinkingLevel === 'xhigh'
        && record(payload.model).provider === selectedModelIdentity.provider
        && record(payload.model).modelId === selectedModelIdentity.modelId;
    },
  });

  await showChatComposer(page);
  const policyUpdateBefore = (await readRpcRequests(page, 'agent.chat.approvalPolicy.update')).length;
  canvasExecuteBefore = (await readRpcRequests(page, 'canvas.execute')).length;
  const approvalButton = page.getByRole('button', {
    name: /^Protected operations approval mode:/,
  });
  await approvalButton.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  assert.ok((await approvalButton.getAttribute('aria-label'))?.includes('Manual approval'));
  await approvalButton.click();
  await page.getByRole('menuitemradio', { name: /^Always approve/ }).click();
  await waitForSuccessfulRpcRequest({
    afterCount: policyUpdateBefore,
    label: 'the exact-chat approval policy update',
    page,
    path: 'agent.chat.approvalPolicy.update',
    predicate: (request) => {
      const input = record(request.input);
      return input.widgetId === initial.widgetId
        && input.sessionId === initial.sessionId
        && record(input.policy).mode === 'always-approve';
    },
  });
  await waitForSuccessfulRpcRequest({
    afterCount: canvasExecuteBefore,
    label: 'the durable per-chat approval preference',
    page,
    path: 'canvas.execute',
    predicate: (request) => {
      const node = canvasCommandWidgetNode(request);
      return node?.id === initial.widgetId
        && record(aiChatPayload(node).approvalPolicy).mode === 'always-approve';
    },
  });
  await showChatComposer(page);
  await approvalButton.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  assert.ok((await approvalButton.getAttribute('aria-label'))?.includes('Always approve'));

  const connectBefore = (await readRpcRequests(page, 'agent.chat.connect')).length;
  const resetBefore = (await readRpcRequests(page, 'agent.chat.newSession')).length;
  canvasExecuteBefore = (await readRpcRequests(page, 'canvas.execute')).length;
  await page.getByRole('button', { name: 'Chat actions' }).click();
  await page.getByRole('menuitem', { name: 'New chat', exact: true }).click();
  const nextConnect = await waitForSuccessfulRpcRequest({
    afterCount: connectBefore,
    label: 'the replacement New Chat session',
    page,
    path: 'agent.chat.connect',
    predicate: (request) => {
      const input = record(request.input);
      return input.widgetId === initial.widgetId
        && input.sessionId !== initial.sessionId
        && record(input.approvalPolicy).mode === 'manual';
    },
  });
  const nextSessionId = record(nextConnect.input).sessionId;
  assert.ok(typeof nextSessionId === 'string' && nextSessionId.length > 0);
  await waitForSuccessfulRpcRequest({
    afterCount: resetBefore,
    label: 'the retired previous AI Chat session',
    page,
    path: 'agent.chat.newSession',
    predicate: (request) => {
      const input = record(request.input);
      return input.widgetId === initial.widgetId && input.sessionId === initial.sessionId;
    },
  });
  const persistedNewChat = await waitForSuccessfulRpcRequest({
    afterCount: canvasExecuteBefore,
    label: 'the Canvas-authored New Chat session and preferences',
    page,
    path: 'canvas.execute',
    predicate: (request) => {
      const node = canvasCommandWidgetNode(request);
      const payload = node === null ? {} : aiChatPayload(node);
      const model = record(payload.model);
      return node?.id === initial.widgetId && payload.sessionId === nextSessionId
        && record(payload.approvalPolicy).mode === 'manual'
        && payload.thinkingLevel === 'xhigh'
        && model.provider === selectedModelIdentity.provider
        && model.modelId === selectedModelIdentity.modelId;
    },
  });
  assert.equal(aiChatPayload(canvasCommandWidgetNode(persistedNewChat)!).sessionId, nextSessionId);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.omnidraw-canvas-host').waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  await page.locator('.omnidraw-ai-chat-shell').waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  await waitForRpcConnection(page);
  await waitForSuccessfulRpcRequest({
    afterCount: 0,
    label: 'the persisted New Chat session after reload',
    page,
    path: 'agent.chat.connect',
    predicate: (request) => {
      const input = record(request.input);
      return input.widgetId === initial.widgetId
        && input.sessionId === nextSessionId
        && record(input.approvalPolicy).mode === 'manual';
    },
  });
  await showChatComposer(page);
  const preferenceText = (await modelButton.innerText()).replace(/\s+/gu, ' ').trim();
  assert.ok(
    preferenceText.includes(selectedModelName.replace(/^GPT-/iu, '')),
    `Reload lost model preference '${selectedModelName}': ${preferenceText}`,
  );
  assert.ok(preferenceText.includes('Xhigh'), `Reload lost xhigh preference: ${preferenceText}`);
  assert.ok((await page.getByRole('button', {
    name: /^Protected operations approval mode:/,
  }).getAttribute('aria-label'))?.includes('Manual approval'));
  await assertNoHandledErrorAlerts(page, 'New Chat and preference reload');
  return Object.freeze({ sessionId: nextSessionId as string, widgetId: initial.widgetId });
}

async function exerciseDeterministicPrompt(args: Readonly<{
  chat: Readonly<{ sessionId: string; widgetId: string }>;
  page: Page;
  provider: TFakeProvider;
}>): Promise<void> {
  await showChatComposer(args.page);
  const maximize = args.page.getByRole('button', { name: 'Maximize AI Chat', exact: true });
  await maximize.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  await maximize.click();
  await args.page.getByRole('button', { name: 'Restore AI Chat', exact: true }).waitFor({
    state: 'visible',
    timeout: ROUTE_TIMEOUT_MS,
  });
  const promptBefore = (await readRpcRequests(args.page, 'agent.chat.prompt')).length;
  const historyBefore = (await readRpcRequests(args.page, 'agent.chat.history')).length;
  const providerBefore = args.provider.requests.length;
  const editor = args.page.getByRole('combobox', {
    name: 'Ask about your canvas. Type @ to add context',
    exact: true,
  });
  await editor.click();
  await editor.pressSequentially(PROMPT_TEXT, { delay: 1 });
  assert.equal(
    (await editor.innerText()).trim(),
    PROMPT_TEXT,
    'Visible ProseMirror prompt text diverged before submission.',
  );
  const send = args.page.getByRole('button', { name: 'Send prompt', exact: true });
  await send.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  assert.equal(await send.isEnabled(), true, 'Visible prompt send action was disabled.');
  await editor.press('Enter');
  const startedPrompts = await waitForBrowserState({
    label: 'the visible agent.chat.prompt Request',
    read: () => readRpcRequests(args.page, 'agent.chat.prompt'),
    ready: (requests) => requests.slice(promptBefore).some((request) => (
      record(request.input).text === PROMPT_TEXT
    )),
  });
  const startedPrompt = startedPrompts.slice(promptBefore).findLast((request) => (
    record(request.input).text === PROMPT_TEXT
  ));
  assert.ok(startedPrompt !== undefined, 'The visible prompt did not enter the private RPC wire.');
  assert.equal(record(startedPrompt.input).widgetId, args.chat.widgetId);
  assert.equal(record(startedPrompt.input).sessionId, args.chat.sessionId);
  assert.deepEqual(record(startedPrompt.input).model, {
    provider: FAKE_PROVIDER_ID,
    modelId: FAKE_MODEL_ID,
  });
  assert.equal(record(startedPrompt.input).thinkingLevel, 'xhigh');
  await waitForBrowserState({
    label: 'the deterministic provider request',
    read: async () => args.provider.requests.length,
    ready: (count) => count > providerBefore,
  });
  const providerRequest = args.provider.requests.at(-1);
  assert.ok(providerRequest !== undefined);
  assert.equal(providerRequest.path, '/v1/chat/completions');
  assert.equal(providerRequest.authorization, 'Bearer browser-acceptance-key');
  assert.equal(providerRequest.model, FAKE_MODEL_ID);
  assert.equal(providerRequest.reasoningEffort, 'xhigh');
  assert.equal(providerRequest.stream, true);
  assert.ok(
    providerRequest.messageText.includes(PROMPT_TEXT),
    'The local provider request omitted the visible browser prompt.',
  );
  assert.ok(
    (await readRpcRequests(args.page, 'agent.events')).length > 0,
    'AI Chat did not establish its typed event stream.',
  );
  await waitForBrowserState({
    label: 'the partial assistant response on the agent event stream',
    read: () => args.page.evaluate((marker) => {
      const transport = (window as unknown as {
        __omnidrawBrowserAcceptance: { snapshot(): TTransportEvidence };
      }).__omnidrawBrowserAcceptance.snapshot();
      return transport.rpcConnections.some((connection) => connection.incomingFrames.some((frame) => (
        frame.includes(marker)
      )));
    }, PARTIAL_RESPONSE_TEXT),
    ready: Boolean,
  });
  await args.page.getByText(PROMPT_TEXT, { exact: true }).waitFor({
    state: 'visible',
    timeout: ROUTE_TIMEOUT_MS,
  });
  await args.page.getByText(PARTIAL_RESPONSE_TEXT, { exact: true }).waitFor({
    state: 'visible',
    timeout: ROUTE_TIMEOUT_MS,
  });
  await args.page.getByRole('button', { name: 'Stop response', exact: true }).waitFor({
    state: 'visible',
    timeout: ROUTE_TIMEOUT_MS,
  });

  args.provider.releaseResponse();
  await args.page.getByText(COMPLETE_RESPONSE_TEXT, { exact: true }).waitFor({
    state: 'visible',
    timeout: ROUTE_TIMEOUT_MS,
  });
  await waitForSuccessfulRpcRequest({
    afterCount: promptBefore,
    label: 'the visible deterministic prompt completion',
    page: args.page,
    path: 'agent.chat.prompt',
    predicate: (request) => {
      const input = record(request.input);
      return input.widgetId === args.chat.widgetId
        && input.sessionId === args.chat.sessionId
        && input.text === PROMPT_TEXT
        && record(input.model).provider === FAKE_PROVIDER_ID
        && record(input.model).modelId === FAKE_MODEL_ID
        && input.thinkingLevel === 'xhigh';
    },
  });
  const history = await waitForSuccessfulRpcRequest({
    afterCount: historyBefore,
    label: 'the post-stream authoritative chat history refresh',
    page: args.page,
    path: 'agent.chat.history',
    predicate: (request) => {
      const input = record(request.input);
      return input.widgetId === args.chat.widgetId && input.sessionId === args.chat.sessionId;
    },
  });
  const historyText = JSON.stringify(history.exit?.value);
  assert.ok(historyText.includes(PROMPT_TEXT), 'Authoritative chat history omitted the visible user prompt.');
  assert.ok(historyText.includes(COMPLETE_RESPONSE_TEXT), 'Authoritative chat history omitted the streamed assistant response.');
  await mkdir(join(ROOT, 'tests/artifacts'), { recursive: true });
  await args.page.screenshot({
    path: join(ROOT, 'tests/artifacts/live-ai-chat-stream-complete.png'),
    fullPage: true,
  });
  await assertNoHandledErrorAlerts(args.page, 'deterministic prompt and history');
}

async function placeDraftPreviewWidget(page: Page): Promise<Readonly<{
  identity: unknown;
  nodeId: string;
}>> {
  const host = page.locator('.omnidraw-canvas-engine-host');
  await host.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  const expand = page.getByRole('button', { name: 'Expand acceptance widget group' });
  if (await expand.count()) await expand.click();
  const row = page.getByRole('button', {
    name: 'Browser Acceptance Widget, draft, healthy.',
    exact: true,
  });
  await row.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  await page.getByRole('button', {
    name: 'Add Browser Acceptance Widget draft to canvas',
    exact: true,
  }).waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  const [hostBounds, rowBounds] = await Promise.all([host.boundingBox(), row.boundingBox()]);
  assert.ok(hostBounds !== null, 'Canvas bounds are unavailable for sidebar placement.');
  assert.ok(rowBounds !== null, 'Draft widget row bounds are unavailable.');
  const target = {
    x: hostBounds.x + hostBounds.width * 0.38,
    y: hostBounds.y + hostBounds.height * 0.28,
  };
  const rowOrigin = {
    x: rowBounds.x + rowBounds.width / 2,
    y: rowBounds.y + rowBounds.height / 2,
  };
  const canvasExecuteBefore = (await readRpcRequests(page, 'canvas.execute')).length;
  const previewOpenBefore = (await readRpcRequests(page, 'widget.preview.open')).length;
  const canvasPathBeforeDrag = new URL(page.url()).pathname;
  await page.mouse.move(rowOrigin.x, rowOrigin.y);
  await page.mouse.down();
  await page.mouse.move(rowOrigin.x + 12, rowOrigin.y + 8, { steps: 3 });
  await page.mouse.move(target.x, target.y, { steps: 12 });
  assert.equal(
    await page.locator('body').evaluate((body) => body.style.userSelect),
    'none',
    'Sidebar pointer movement never crossed the production drag threshold.',
  );
  await page.mouse.up();
  assert.equal(
    await page.locator('body').evaluate((body) => body.style.userSelect),
    '',
    'Sidebar placement did not restore document selection after pointerup.',
  );
  assert.equal(
    new URL(page.url()).pathname,
    canvasPathBeforeDrag,
    'Completing a sidebar pointer-drag navigated away from the Canvas instead of suppressing the row click.',
  );

  const command = await waitForSuccessfulRpcRequest({
    afterCount: canvasExecuteBefore,
    label: 'the accepted draft Preview placement command',
    page,
    path: 'canvas.execute',
    predicate: (request) => {
      const node = canvasCommandWidgetNode(request);
      const extension = node === null ? {} : canvasWidgetExtension(node);
      return extension.type === 'widget-preview' && extension.widgetKey === 'browser-acceptance';
    },
  });
  const node = canvasCommandWidgetNode(command);
  assert.ok(node !== null && typeof node.id === 'string');
  assert.deepEqual(record(node.size), { width: 360, height: 320 });
  const position = record(record(node.transform).position);
  assert.ok(Number.isFinite(position.x), 'Draft Preview x position is not finite.');
  assert.ok(Number.isFinite(position.y), 'Draft Preview y position is not finite.');
  assert.ok(
    Math.abs(Number(position.x) - target.x) > 50,
    'Sidebar placement committed raw client x instead of Canvas world coordinates.',
  );
  const previewOpen = await waitForSuccessfulRpcRequest({
    afterCount: previewOpenBefore,
    label: 'the mounted draft Preview artifact',
    page,
    path: 'widget.preview.open',
    predicate: (request) => record(request.input).elementId === node.id,
  });
  assert.equal(record(previewOpen.input).widgetKey, 'browser-acceptance');
  const portalSelector = `[data-vibecanvas-portal-id="omnidraw:widget:${node.id}"]`;
  const portal = page.locator(portalSelector);
  await portal.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  assert.ok(
    await portal.evaluate((element) => element.childElementCount) > 0,
    'Draft Preview portal is visible but has no mounted host content.',
  );
  const portalBounds = await portal.boundingBox();
  assert.ok(portalBounds !== null, 'Draft Preview portal did not expose visible bounds.');
  assert.ok(portalBounds.width >= 300 && portalBounds.height >= 260, 'Draft Preview portal collapsed below its authored frame.');
  assert.ok(portalBounds.x >= hostBounds.x - 2, 'Draft Preview escaped the Canvas left edge.');
  assert.ok(portalBounds.y >= hostBounds.y - 2, 'Draft Preview escaped the Canvas top edge.');
  assert.ok(
    portalBounds.x + portalBounds.width <= hostBounds.x + hostBounds.width + 2,
    'Draft Preview escaped the Canvas right edge.',
  );
  assert.ok(
    portalBounds.y + portalBounds.height <= hostBounds.y + hostBounds.height + 2,
    'Draft Preview escaped the Canvas bottom edge.',
  );
  await assertDraftPreviewTitlebar(page, 'draft Preview placement', node.id);
  await assertDraftGuestMounted(page, portal, 'draft Preview placement');
  await mkdir(join(ROOT, 'tests/artifacts'), { recursive: true });
  await page.screenshot({
    path: join(ROOT, 'tests/artifacts/live-draft-preview-mounted.png'),
    fullPage: true,
  });
  await assertNoHandledErrorAlerts(page, 'draft Preview placement');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.omnidraw-canvas-host').waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  await waitForRpcConnection(page);
  await waitForSuccessfulRpcRequest({
    afterCount: 0,
    label: 'the persisted draft Preview artifact after reload',
    page,
    path: 'widget.preview.open',
    predicate: (request) => record(request.input).elementId === node.id,
  });
  const reloadedPortal = page.locator(portalSelector);
  await reloadedPortal.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  await assertDraftGuestMounted(page, reloadedPortal, 'draft Preview reload');
  await assertNoHandledErrorAlerts(page, 'draft Preview reload');
  return Object.freeze({ identity: previewMountIdentity(previewOpen), nodeId: node.id });
}

function previewMountIdentity(request: TRpcWireRequest): unknown {
  const value = record(request.exit?.value);
  const runtime = record(value.runtime ?? value.runtimeDescriptor);
  const artifact = record(value.artifact);
  return Object.freeze({
    artifactDigestSha256: artifact.digestSha256,
    artifactHash: runtime.artifactHash,
    functionDescriptors: value.functionDescriptors,
    identity: value.identity,
    manifest: value.manifest,
    runtime,
  });
}

async function placeProfilePreview(
  page: Page,
  fixture: Readonly<{ name: string; widgetKey: string }>,
): Promise<Readonly<{ identity: unknown; nodeId: string }>> {
  const expand = page.getByRole('button', { name: 'Expand acceptance widget group' });
  if (await expand.count()) await expand.click();
  const executeBefore = (await readRpcRequests(page, 'canvas.execute')).length;
  const openBefore = (await readRpcRequests(page, 'widget.preview.open')).length;
  await page.getByRole('button', {
    name: `Add ${fixture.name} draft to canvas`,
    exact: true,
  }).click();
  const command = await waitForSuccessfulRpcRequest({
    afterCount: executeBefore,
    label: `${fixture.name} placement`,
    page,
    path: 'canvas.execute',
    predicate: (request) => {
      const node = canvasCommandWidgetNode(request);
      const extension = node === null ? {} : canvasWidgetExtension(node);
      return extension.type === 'widget-preview' && extension.widgetKey === fixture.widgetKey;
    },
  });
  const node = canvasCommandWidgetNode(command);
  assert.ok(node !== null && typeof node.id === 'string');
  const open = await waitForSuccessfulRpcRequest({
    afterCount: openBefore,
    label: `${fixture.name} accepted artifact`,
    page,
    path: 'widget.preview.open',
    predicate: (request) => record(request.input).elementId === node.id,
  });
  const portal = page.locator(`[data-vibecanvas-portal-id="omnidraw:widget:${node.id}"]`);
  await portal.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  await assertDraftGuestMounted(page, portal, fixture.name);
  assert.equal(
    await portal.locator('[data-omnidraw-widget-preview-failure]').count(),
    0,
    `${fixture.name} rendered a failure surface instead of its first frame.`,
  );
  return Object.freeze({ identity: previewMountIdentity(open), nodeId: node.id });
}

async function readWidgetRuntimeDiagnostics(page: Page): Promise<TWidgetRuntimeDiagnostics | null> {
  return page.evaluate(async () => {
    const diagnostics = (window as unknown as {
      __OMNIDRAW_WIDGET_RUNTIME_DIAGNOSTICS__?: () => Promise<TWidgetRuntimeDiagnostics>;
    }).__OMNIDRAW_WIDGET_RUNTIME_DIAGNOSTICS__;
    return diagnostics === undefined ? null : diagnostics();
  });
}

async function panCanvasToDistantViewport(page: Page, reverse = false): Promise<void> {
  const host = page.locator('.omnidraw-canvas-engine-host');
  const bounds = await host.boundingBox();
  assert.ok(bounds !== null, 'Canvas bounds are unavailable for the runtime scheduling pan.');
  const near = { x: bounds.x + 24, y: bounds.y + bounds.height - 24 };
  const far = { x: bounds.x + bounds.width - 24, y: near.y };
  const start = reverse ? near : far;
  const end = reverse ? far : near;
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.down('Space');
  try {
    for (let gesture = 0; gesture < 3; gesture += 1) {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 12 });
      await page.mouse.up();
    }
  } finally {
    await page.keyboard.up('Space');
  }
}

async function exerciseWidgetRuntimeScheduling(page: Page): Promise<void> {
  await createCanvas(page, 'Runtime Scheduling Acceptance');
  await page.locator('.omnidraw-canvas-host').waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  const fixture = Object.freeze({
    name: 'Browser Acceptance Widget',
    widgetKey: 'browser-acceptance',
  });
  const visible = [] as Array<Readonly<{ identity: unknown; nodeId: string }>>;
  for (let index = 0; index < 4; index += 1) {
    visible.push(await placeProfilePreview(page, fixture));
  }
  for (const candidate of visible.slice(1)) {
    assert.deepEqual(
      candidate.identity,
      visible[0]!.identity,
      'Repeated Preview placements did not resolve the same exact accepted artifact identity.',
    );
  }

  const statefulPortal = page.locator(
    `[data-vibecanvas-portal-id="omnidraw:widget:${visible[0]!.nodeId}"]`,
  );
  const beforeThrottle = await readWidgetRuntimeDiagnostics(page);
  const statefulMount = beforeThrottle?.mounts.find((mount) => mount.nodeId === visible[0]!.nodeId);
  assert.ok(statefulMount !== undefined, 'Repeated DOM widget has no live isolated mount.');
  const opensBeforeThrottle = (await readRpcRequests(page, 'widget.preview.open')).length;

  await panCanvasToDistantViewport(page);
  await waitForBrowserState<TWidgetRuntimeDiagnostics | null>({
    label: 'the original repeated widgets to leave the distant viewport',
    read: () => readWidgetRuntimeDiagnostics(page),
    ready: (evidence) => evidence !== null && visible.every(({ nodeId }) => (
      evidence.mounts.find((mount) => mount.nodeId === nodeId)?.viewport?.visibility === 'hidden'
    )),
  });
  await panCanvasToDistantViewport(page, true);
  await statefulPortal.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  const afterThrottle = await waitForBrowserState<TWidgetRuntimeDiagnostics | null>({
    label: 'the same guest instance after off-screen throttle/resume',
    read: () => readWidgetRuntimeDiagnostics(page),
    ready: (evidence) => evidence?.mounts.some((mount) => (
      mount.nodeId === visible[0]!.nodeId
      && mount.instanceId === statefulMount.instanceId
      && mount.viewport?.visibility === 'visible'
    )) === true,
  });
  assert.equal(afterThrottle?.browserHost.hostCreations, beforeThrottle?.browserHost.hostCreations);
  assert.equal(
    (await readRpcRequests(page, 'widget.preview.open')).length,
    opensBeforeThrottle,
    'Off-screen throttle/resume destroyed and reopened a mounted guest.',
  );
  await panCanvasToDistantViewport(page);
  const offscreen = await placeProfilePreview(page, fixture);
  assert.deepEqual(
    offscreen.identity,
    visible[0]!.identity,
    'The distant repeated Preview did not resolve the same exact accepted artifact identity.',
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.omnidraw-canvas-host').waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  await waitForRpcConnection(page);
  const visibleNodeIds = visible.map(({ nodeId }) => nodeId);
  const cold = await waitForBrowserState<TWidgetRuntimeDiagnostics | null>({
    label: 'visible repeated widgets to settle while the cold off-screen widget remains deferred',
    read: () => readWidgetRuntimeDiagnostics(page),
    ready: (evidence) => evidence !== null
      && evidence.scheduler.active === 0
      && evidence.scheduler.deferred >= 1
      && visibleNodeIds.every((nodeId) => evidence.mounts.some((mount) => mount.nodeId === nodeId))
      && !evidence.mounts.some((mount) => mount.nodeId === offscreen.nodeId),
  });
  assert.ok(cold !== null);
  assert.ok(
    cold.scheduler.started > cold.scheduler.concurrency,
    'The cold visible population did not exceed the configured mount concurrency bound.',
  );
  assert.ok(
    cold.scheduler.peakActive <= cold.scheduler.concurrency,
    `Widget startup exceeded its bounded concurrency: ${JSON.stringify(cold.scheduler)}`,
  );
  assert.equal(
    cold.scheduler.recentStarts.includes(offscreen.nodeId),
    false,
    'The cold off-screen widget started before it became viewport eligible.',
  );
  assert.equal(cold.browserHost.liveHosts, visible.length);
  assert.equal(cold.browserHost.liveMounts, visible.length);
  assert.ok(
    cold.browserHost.hostCreations >= visible.length,
    'The browser host created fewer isolated hosts than live widget mounts.',
  );
  assert.equal(cold.browserHost.artifactCache.entries, 1);
  assert.equal(cold.browserHost.artifactCache.puts, 1);
  assert.ok(
    cold.browserHost.artifactCache.hits >= visible.length - 1,
    `Repeated exact artifacts did not reuse immutable cache work: ${JSON.stringify(cold.browserHost.artifactCache)}`,
  );

  await panCanvasToDistantViewport(page);
  const resumed = await waitForBrowserState<TWidgetRuntimeDiagnostics | null>({
    label: 'the deferred widget to start after entering the viewport',
    read: () => readWidgetRuntimeDiagnostics(page),
    ready: (evidence) => evidence !== null
      && evidence.scheduler.active === 0
      && evidence.mounts.some((mount) => mount.nodeId === offscreen.nodeId),
  });
  assert.ok(resumed !== null);
  assert.equal(resumed.browserHost.liveHosts, visible.length + 1);
  assert.equal(resumed.browserHost.liveMounts, visible.length + 1);
  assert.ok(
    resumed.browserHost.hostCreations > cold.browserHost.hostCreations,
    'Making the deferred widget eligible did not create its isolated Capsule host.',
  );
  assert.equal(resumed.browserHost.artifactCache.entries, 1);
  assert.equal(resumed.browserHost.artifactCache.puts, 1);
  assert.ok(
    resumed.browserHost.artifactCache.hits > cold.browserHost.artifactCache.hits,
    'The newly eligible repeated artifact did not reuse the shared immutable cache.',
  );
  const repeatedMounts = resumed.mounts.filter((mount) => (
    [...visibleNodeIds, offscreen.nodeId].includes(mount.nodeId)
  ));
  assert.equal(repeatedMounts.length, visible.length + 1);
  assert.equal(
    new Set(repeatedMounts.map((mount) => mount.artifactHash)).size,
    1,
    'Repeated instances did not retain one exact artifact hash.',
  );
  assert.equal(
    new Set(repeatedMounts.map((mount) => mount.instanceId)).size,
    repeatedMounts.length,
    'Shared artifact work accidentally shared a Capsule guest instance.',
  );
  await assertNoHandledErrorAlerts(page, 'visible-first widget scheduling and shared artifact caching');
}

async function placeFunctionResourcePreview(page: Page): Promise<void> {
  const expand = page.getByRole('button', { name: 'Expand acceptance widget group' });
  if (await expand.count()) await expand.click();
  const previewButton = page.getByRole('button', {
    name: 'Add Browser Function Resource Widget draft to canvas',
    exact: true,
  });
  await previewButton.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  const canvasExecuteBefore = (await readRpcRequests(page, 'canvas.execute')).length;
  await previewButton.click();
  const command = await waitForSuccessfulRpcRequest({
    afterCount: canvasExecuteBefore,
    label: 'the function/resource Preview placement command',
    page,
    path: 'canvas.execute',
    predicate: (request) => {
      const node = canvasCommandWidgetNode(request);
      const extension = node === null ? {} : canvasWidgetExtension(node);
      return extension.type === 'widget-preview' && extension.widgetKey === FUNCTION_RESOURCE_WIDGET_KEY;
    },
  });
  const node = canvasCommandWidgetNode(command);
  assert.ok(node !== null && typeof node.id === 'string');
  const portal = page.locator(`[data-vibecanvas-portal-id="omnidraw:widget:${node.id}"]`);
  await portal.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  const failure = portal.locator('[data-omnidraw-widget-preview-failure]');
  await failure.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  await failure.getByRole('heading', { name: 'Build required', exact: true }).waitFor({
    state: 'visible',
    timeout: ROUTE_TIMEOUT_MS,
  });
  const rebuild = failure.getByRole('button', { name: 'Rebuild', exact: true });
  await rebuild.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  const expectedToast = page.locator('[role="alert"]', { hasText: 'Build required' });
  if (await expectedToast.count()) await expectedToast.locator('button').click();

  const rebuildBefore = (await readRpcRequests(page, 'widget.preview.rebuildDraft')).length;
  const previewOpenBefore = (await readRpcRequests(page, 'widget.preview.open')).length;
  const invocationBefore = (await readRpcRequests(page, 'widget.preview.invoke')).length;
  await rebuild.click();
  await waitForSuccessfulRpcRequest({
    afterCount: rebuildBefore,
    label: 'the host-accepted function/resource draft rebuild',
    page,
    path: 'widget.preview.rebuildDraft',
    predicate: (request) => record(request.input).widgetKey === FUNCTION_RESOURCE_WIDGET_KEY,
  });
  await waitForSuccessfulRpcRequest({
    afterCount: previewOpenBefore,
    label: 'the accepted function/resource Preview guest after Rebuild',
    page,
    path: 'widget.preview.open',
    predicate: (request) => record(request.input).elementId === node.id,
  });
  await failure.waitFor({ state: 'detached', timeout: ROUTE_TIMEOUT_MS });
  await waitForBrowserState({
    label: 'the accepted function/resource Preview host content',
    read: () => portal.evaluate((element) => element.childElementCount),
    ready: (childCount) => childCount > 0,
  });
  const invocation = await waitForSuccessfulRpcRequest({
    afterCount: invocationBefore,
    label: 'the Capsule Preview server function through its portable KV resource',
    page,
    path: 'widget.preview.invoke',
    predicate: (request) => {
      const input = record(request.input);
      return input.elementId === node.id && input.functionName === 'readAcceptanceValue';
    },
  });
  const result = record(invocation.exit?.value);
  assert.equal(result.status, 'succeeded', `Preview function failed: ${JSON.stringify(result)}`);
  assert.deepEqual(result.output, {
    value: FUNCTION_RESOURCE_VALUE,
    revision: 1,
  });
  await assertFunctionResourceGuestConsumed(
    page,
    portal,
  );
}

async function provePersistentPreGuestPreviewFailure(page: Page): Promise<void> {
  const expand = page.getByRole('button', { name: 'Expand acceptance widget group' });
  if (await expand.count()) await expand.click();
  const previewButton = page.getByRole('button', {
    name: 'Add Browser Unbuilt Widget draft to canvas',
    exact: true,
  });
  await previewButton.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  const canvasExecuteBefore = (await readRpcRequests(page, 'canvas.execute')).length;
  await previewButton.click();
  const command = await waitForSuccessfulRpcRequest({
    afterCount: canvasExecuteBefore,
    label: 'the lockfile-only unbuilt Preview placement command',
    page,
    path: 'canvas.execute',
    predicate: (request) => {
      const node = canvasCommandWidgetNode(request);
      const extension = node === null ? {} : canvasWidgetExtension(node);
      return extension.type === 'widget-preview' && extension.widgetKey === 'browser-unbuilt';
    },
  });
  const node = canvasCommandWidgetNode(command);
  assert.ok(node !== null && typeof node.id === 'string');
  const portal = page.locator(`[data-vibecanvas-portal-id="omnidraw:widget:${node.id}"]`);
  await portal.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  const failure = portal.locator('[data-omnidraw-widget-preview-failure]');
  await failure.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  await failure.getByRole('heading', { name: 'Build required', exact: true }).waitFor({
    state: 'visible',
    timeout: ROUTE_TIMEOUT_MS,
  });
  await failure.getByRole('button', { name: 'Rebuild', exact: true }).waitFor({ state: 'visible' });
  const remove = failure.getByRole('button', { name: 'Remove', exact: true });
  await remove.waitFor({ state: 'visible' });
  assert.ok(
    await portal.evaluate((element) => element.childElementCount) > 0,
    'A pre-guest Preview build failure left the authored frame blank.',
  );
  await mkdir(join(ROOT, 'tests/artifacts'), { recursive: true });
  await page.screenshot({
    path: join(ROOT, 'tests/artifacts/live-draft-preview-build-required.png'),
    fullPage: true,
  });
  const expectedToast = page.locator('[role="alert"]', { hasText: 'Build required' });
  if (await expectedToast.count()) await expectedToast.locator('button').click();
  const rebuildDraftBefore = (await readRpcRequests(page, 'widget.preview.rebuildDraft')).length;
  const previewOpenBefore = (await readRpcRequests(page, 'widget.preview.open')).length;
  await failure.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await waitForSuccessfulRpcRequest({
    afterCount: rebuildDraftBefore,
    label: 'the private exact-lock rebuild for the lockfile-only draft',
    page,
    path: 'widget.preview.rebuildDraft',
    predicate: (request) => record(request.input).widgetKey === 'browser-unbuilt',
  });
  await waitForSuccessfulRpcRequest({
    afterCount: previewOpenBefore,
    label: 'the accepted lockfile-only draft guest after Rebuild',
    page,
    path: 'widget.preview.open',
    predicate: (request) => record(request.input).elementId === node.id,
  });
  await failure.waitFor({ state: 'detached', timeout: ROUTE_TIMEOUT_MS });
  await assertDraftGuestMounted(page, portal, 'lockfile-only draft Rebuild');
}

async function restartBackendWithMountedChat(args: Readonly<{
  expectedHistoryText: string;
  page: Page;
  restartBackend(): Promise<void>;
}>): Promise<void> {
  const before = await args.page.evaluate(() => (
    (window as unknown as {
      __omnidrawBrowserAcceptance: { snapshot(): TTransportEvidence };
    }).__omnidrawBrowserAcceptance.snapshot()
  ));
  await args.restartBackend();
  const recovered = await waitForBrowserState<Readonly<{
    complete: boolean;
    exit: null | Readonly<{ _tag?: string; cause?: unknown; value?: unknown }>;
    rpcOpenCount: number;
  }>>({
    label: 'AI Chat to reconnect after a backend process restart',
    read: () => args.page.evaluate((previousOpenCount) => {
      const transport = (window as unknown as {
        __omnidrawBrowserAcceptance: { snapshot(): TTransportEvidence };
      }).__omnidrawBrowserAcceptance.snapshot();
      const connection = transport.rpcConnections.findLast((candidate) => (
        (candidate.openSequence ?? 0) > previousOpenCount
      ));
      if (connection === undefined) {
        return { complete: false, exit: null, rpcOpenCount: transport.rpcOpenCount };
      }
      const connectRequests = connection.outgoingFrames.flatMap((chunk) => chunk.split('\n')).flatMap((frame) => {
        if (!frame.trim()) return [];
        try {
          const value = JSON.parse(frame) as { id?: number; payload?: { path?: string } };
          return value.payload?.path === 'agent.chat.connect' && typeof value.id === 'number'
            ? [value.id]
            : [];
        } catch {
          return [];
        }
      });
      const requestId = connectRequests.at(-1);
      if (requestId === undefined) {
        return { complete: false, exit: null, rpcOpenCount: transport.rpcOpenCount };
      }
      const exits = connection.incomingFrames.flatMap((chunk) => chunk.split('\n')).flatMap((frame) => {
        if (!frame.trim()) return [];
        try {
          const value = JSON.parse(frame) as {
            _tag?: string;
            exit?: { _tag?: string; cause?: unknown; value?: unknown };
            requestId?: number;
          };
          return value._tag === 'Exit' && value.requestId === requestId ? [value.exit ?? null] : [];
        } catch {
          return [];
        }
      });
      return {
        complete: exits.length > 0,
        exit: exits.at(-1) ?? null,
        rpcOpenCount: transport.rpcOpenCount,
      };
    }, before.rpcOpenCount),
    ready: (value) => value.complete,
  });
  assert.ok(
    recovered.rpcOpenCount > before.rpcOpenCount,
    'Restarting the backend did not create a new native RPC connection.',
  );
  assert.equal(
    recovered.exit?._tag,
    'Success',
    `AI Chat did not reconnect after backend restart: ${JSON.stringify(recovered.exit)}`,
  );
  assert.ok(
    JSON.stringify(recovered.exit?.value).includes(args.expectedHistoryText),
    'AI Chat reconnect succeeded after backend restart but omitted the persisted response history.',
  );
  await args.page.locator('.omnidraw-ai-chat-shell').waitFor({ state: 'visible' });
  await args.page.getByText(args.expectedHistoryText, { exact: true }).waitFor({
    state: 'visible',
    timeout: ROUTE_TIMEOUT_MS,
  });
  assert.equal(
    await args.page.getByText('Could not connect to AI chat', { exact: true }).count(),
    0,
    'AI Chat showed a connection alert after backend process recovery.',
  );
}

async function createResources(page: Page): Promise<readonly TCreatedResource[]> {
  const inputs = [
    { kind: 'kv', name: 'Browser KV' },
    { kind: 'db', name: 'Browser Database' },
  ] as const;
  const created: TCreatedResource[] = [];
  for (const input of inputs) {
    await page.getByRole('button', { name: 'Add resource' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create resource' });
    await dialog.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
    await dialog.getByLabel('Resource type').selectOption(input.kind);
    await dialog.getByLabel('Name').fill(input.name);
    await dialog.getByRole('button', { name: 'Create resource' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: ROUTE_TIMEOUT_MS });
    const item = page.locator('aside[aria-label="Canvas navigation"] button').filter({ hasText: input.name });
    await item.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
    await waitForBrowserState<string | null>({
      label: `${input.name} to become ready`,
      read: () => item.getAttribute('title'),
      ready: (title) => title?.endsWith(' · ready') === true,
    });
    await item.click();
    await page.waitForURL((url) => /^\/resources\/[^/]+$/.test(url.pathname), {
      timeout: ROUTE_TIMEOUT_MS,
    });
    created.push(Object.freeze({
      id: new URL(page.url()).pathname.split('/').at(-1) ?? '',
      kind: input.kind,
      name: input.name,
      status: 'ready',
    }));
  }
  return Object.freeze(created);
}

async function seedFunctionResourceValue(
  page: Page,
  baseUrl: string,
  resource: TCreatedResource,
): Promise<void> {
  await page.goto(new URL(`/resources/${resource.id}?tab=data`, baseUrl).toString(), {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('button', { name: 'Add value', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add value', exact: true });
  await dialog.getByLabel('Key', { exact: true }).fill(FUNCTION_RESOURCE_KEY);
  await dialog.getByLabel('JSON value', { exact: true }).fill(JSON.stringify(FUNCTION_RESOURCE_VALUE));
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByText(FUNCTION_RESOURCE_KEY, { exact: true }).waitFor({
    state: 'visible',
    timeout: ROUTE_TIMEOUT_MS,
  });
}

async function assertRoute(
  page: Page,
  baseUrl: string,
  route: string,
  visibleText: string,
): Promise<void> {
  await page.goto(new URL(route, baseUrl).toString(), { waitUntil: 'domcontentloaded' });
  await page.getByText(visibleText, { exact: true }).first().waitFor({
    state: 'visible',
    timeout: ROUTE_TIMEOUT_MS,
  });
  const expected = new URL(route, baseUrl);
  const actual = new URL(page.url());
  assert.equal(actual.pathname, expected.pathname, `Route '${route}' changed its pathname.`);
  assert.equal(
    actual.searchParams.get('tab'),
    expected.searchParams.get('tab'),
    `Route '${route}' changed its selected tab.`,
  );
}

async function exerciseWidgetInspectorRoutes(page: Page, baseUrl: string): Promise<void> {
  await assertRoute(
    page,
    baseUrl,
    '/widgets/draft/browser-acceptance?tab=overview',
    'Browser Acceptance Widget',
  );

  const selectTab = async (name: string, value: string, visibleText: string): Promise<void> => {
    await page.getByRole('tab', { name, exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get('tab') === value, {
      timeout: ROUTE_TIMEOUT_MS,
    });
    await page.getByText(visibleText, { exact: true }).first().waitFor({
      state: 'visible',
      timeout: ROUTE_TIMEOUT_MS,
    });
  };

  await selectTab('Config', 'config', 'Widget Config');
  const saveBefore = (await readRpcRequests(page, 'widget.config.saveDraft')).length;
  const description = page.getByLabel('Description', { exact: true });
  await description.fill('A deterministic draft exercised through the live widget inspector.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await waitForSuccessfulRpcRequest({
    afterCount: saveBefore,
    label: 'the visible widget Config save action',
    page,
    path: 'widget.config.saveDraft',
  });

  await selectTab('Functions', 'functions', 'Browser-safe function descriptors');
  await selectTab('Resources', 'resources', 'Portable resource requirements');
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get('tab') === 'files', {
    timeout: ROUTE_TIMEOUT_MS,
  });
  const fileTree = page.locator('[aria-label="Widget files"]');
  await fileTree.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  const sourceFile = fileTree.getByRole('button').filter({ hasText: 'main.ts' });
  await sourceFile.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
  await sourceFile.click();
  await page.getByText('ui/main.ts', { exact: true }).waitFor({
    state: 'visible',
    timeout: ROUTE_TIMEOUT_MS,
  });
}

async function exerciseResourceWorkbenches(
  page: Page,
  baseUrl: string,
  resources: Readonly<Record<TCreatedResource['kind'], TCreatedResource>>,
): Promise<void> {
  await page.goto(new URL(`/resources/${resources.kv.id}?tab=data`, baseUrl).toString(), {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('button', { name: 'Add value', exact: true }).click();
  const valueDialog = page.getByRole('dialog', { name: 'Add value', exact: true });
  await valueDialog.getByLabel('Key', { exact: true }).fill('acceptance/value');
  await valueDialog.getByLabel('JSON value', { exact: true }).fill('{"verified":true}');
  await valueDialog.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByText('acceptance/value', { exact: true }).waitFor({
    state: 'visible',
    timeout: ROUTE_TIMEOUT_MS,
  });
  await page.screenshot({
    path: join(ROOT, 'tests/artifacts/live-resource-kv.png'),
    fullPage: true,
  });

  await page.goto(new URL(`/resources/${resources.db.id}?tab=overview`, baseUrl).toString(), {
    waitUntil: 'domcontentloaded',
  });
  for (const [name, value, visibleText] of [
    ['Schema', 'schema', 'Live schema'],
    ['Data', 'data', 'No user tables.'],
    ['SQL', 'sql', 'Live SQL console'],
  ] as const) {
    await page.getByRole('tab', { name, exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get('tab') === value, {
      timeout: ROUTE_TIMEOUT_MS,
    });
    await page.getByText(visibleText, { exact: true }).first().waitFor({
      state: 'visible',
      timeout: ROUTE_TIMEOUT_MS,
    });
  }
  await page.getByLabel('One SQLite-compatible statement', { exact: true }).fill('SELECT 42 AS answer;');
  await page.getByRole('button', { name: 'Run against live', exact: true }).click();
  await page.getByRole('columnheader', { name: 'answer', exact: true }).waitFor({
    state: 'visible',
    timeout: ROUTE_TIMEOUT_MS,
  });
  await page.getByRole('cell', { name: '42', exact: true }).waitFor({
    state: 'visible',
    timeout: ROUTE_TIMEOUT_MS,
  });
  await page.screenshot({
    path: join(ROOT, 'tests/artifacts/live-resource-database-sql.png'),
    fullPage: true,
  });
}

async function runBrowserSuite(
  baseUrl: string,
  restartBackend: () => Promise<void>,
  provider: TFakeProvider,
  home: string,
): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const browserErrors: string[] = [];
  const badResponses: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || SOLID_DEV_DIAGNOSTIC.test(message.text())) {
      browserErrors.push(`console ${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => browserErrors.push(`page: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });
  await installWebSocketEvidence(page);

  try {
    console.log('[browser:live] app shell, Canvas, and native WebSocket reconnect');
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForURL((url) => url.pathname.startsWith('/c/'), { timeout: ROUTE_TIMEOUT_MS });
    await page.locator('.omnidraw-canvas-host').waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
    await page.getByRole('button', { name: 'Select', exact: true }).waitFor({ state: 'visible' });
    await waitForRpcConnection(page);
    const initialCanvasId = new URL(page.url()).pathname.split('/').at(-1) ?? '';
    assert.ok(initialCanvasId.length > 0, 'Startup did not create the clean-home Canvas.');

    console.log('[browser:live] durable Arrow tail/head binding and target movement');
    const arrowEvidence = await exerciseDurableArrowConnections(page);

    console.log('[browser:live] fresh AI Chat widget short-drag portal and connection');
    const initialChat = await placeShortAiChatWidget(page);

    console.log('[browser:live] selected Canvas layers stay below shared application dialogs');
    await exerciseSelectedCanvasDialogOcclusion(page, initialChat.widgetId);

    console.log('[browser:live] New Chat, model, and thinking persistence across reload');
    const persistedChat = await persistAiChatStateAcrossReload(page, initialChat);

    console.log('[browser:live] visible prompt, deterministic provider stream, and authoritative history');
    await exerciseDeterministicPrompt({ chat: persistedChat, page, provider });

    console.log('[browser:live] mounted AI Chat recovery after a real backend process restart');
    await restartBackendWithMountedChat({
      expectedHistoryText: COMPLETE_RESPONSE_TEXT,
      page,
      restartBackend,
    });
    await assertArrowRecoveryAfterBackendRestart(page, arrowEvidence);
    const restoreChat = page.getByRole('button', { name: 'Restore AI Chat', exact: true });
    if (await restoreChat.isVisible()) await restoreChat.click();
    await page.getByRole('button', { name: 'Maximize AI Chat', exact: true }).waitFor({
      state: 'visible',
      timeout: ROUTE_TIMEOUT_MS,
    });

    console.log('[browser:live] create and bind the Preview function resource fixture');
    const resources = await createResources(page);
    assert.deepEqual(resources.map((resource) => resource.kind), ['kv', 'db']);
    const byKind = Object.fromEntries(resources.map((resource) => [resource.kind, resource])) as Record<
      TCreatedResource['kind'],
      TCreatedResource
    >;
    await seedFunctionResourceValue(page, baseUrl, byKind.kv);
    await bindFunctionResourceDraft(home, byKind.kv.id);
    await restartBackend();
    await page.goto(new URL(`/c/${initialCanvasId}`, baseUrl).toString(), {
      waitUntil: 'domcontentloaded',
    });
    await page.locator('.omnidraw-canvas-host').waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
    await waitForRpcConnection(page);

    console.log('[browser:live] fixed Preview server function and portable KV bridge');
    await placeFunctionResourcePreview(page);

    console.log('[browser:live] real sidebar pointer-drag draft Preview portal and reload');
    const preview = await placeDraftPreviewWidget(page);
    console.log('[browser:live] executable Canvas 2D and indexed RawShaderMaterial WebGL Preview profiles');
    const profileFixtures = [{
      name: 'Browser Canvas 2D Widget',
      widgetKey: 'browser-canvas-2d',
    }, {
      name: 'Browser WebGL Widget',
      widgetKey: 'browser-webgl',
    }] as const;
    const profilePreviews = [] as Array<Readonly<{ identity: unknown; nodeId: string }>>;
    for (const fixture of profileFixtures) {
      profilePreviews.push(await placeProfilePreview(page, fixture));
    }
    console.log('[browser:live] mounted draft Preview recovery after a real backend process restart');
    await restartBackend();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.omnidraw-canvas-host').waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
    await waitForRpcConnection(page);
    const restartedPreviewPortal = page.locator(
      `[data-vibecanvas-portal-id="omnidraw:widget:${preview.nodeId}"]`,
    );
    const restartedDomOpen = await waitForSuccessfulRpcRequest({
      afterCount: 0,
      label: 'the DOM fixture cold backend remount',
      page,
      path: 'widget.preview.open',
      predicate: (request) => record(request.input).elementId === preview.nodeId,
    });
    assert.deepEqual(
      previewMountIdentity(restartedDomOpen),
      preview.identity,
      'The DOM fixture changed accepted artifact, runtime policy, manifest, or signing identity across restart.',
    );
    await restartedPreviewPortal.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
    await assertDraftGuestMounted(page, restartedPreviewPortal, 'draft Preview backend restart');
    for (let index = 0; index < profileFixtures.length; index += 1) {
      const fixture = profileFixtures[index]!;
      const previous = profilePreviews[index]!;
      const open = await waitForSuccessfulRpcRequest({
        afterCount: 0,
        label: `${fixture.name} cold backend remount`,
        page,
        path: 'widget.preview.open',
        predicate: (request) => record(request.input).elementId === previous.nodeId,
      });
      assert.deepEqual(
        previewMountIdentity(open),
        previous.identity,
        `${fixture.name} changed accepted artifact, runtime policy, manifest, or signing identity across restart.`,
      );
      const portal = page.locator(`[data-vibecanvas-portal-id="omnidraw:widget:${previous.nodeId}"]`);
      await portal.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
      await assertDraftGuestMounted(page, portal, `${fixture.name} cold backend remount`);
      assert.equal(await portal.locator('[data-omnidraw-widget-preview-failure]').count(), 0);
    }
    assert.equal(
      (await readRpcRequests(page, 'widget.preview.rebuildDraft')).length,
      0,
      'Cold accepted-Preview recovery invoked the explicit portable rebuild operation.',
    );
    await assertNoHandledErrorAlerts(page, 'backend restart recovery');

    console.log('[browser:live] visible-first bounded startup and isolated shared-artifact reuse');
    await exerciseWidgetRuntimeScheduling(page);

    await createCanvas(page, 'Preview Failure Follow-up');
    await page.locator('.omnidraw-canvas-host').waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });

    console.log('[browser:live] persistent non-blank pre-guest Preview build failure');
    await provePersistentPreGuestPreviewFailure(page);

    console.log('[browser:live] screen-atlas app and widget route families');
    await assertRoute(page, baseUrl, '/', 'Welcome to Omnidraw');
    await exerciseWidgetInspectorRoutes(page, baseUrl);

    console.log('[browser:live] screen-atlas resource route families');
    await waitForRpcConnection(page);
    await exerciseResourceWorkbenches(page, baseUrl, byKind);

    console.log('[browser:live] native WebSocket disconnect, reconnect, and stale-generation fencing');
    await page.goto(new URL(`/c/${initialCanvasId}`, baseUrl).toString(), { waitUntil: 'domcontentloaded' });
    await page.locator('.omnidraw-canvas-host').waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
    await waitForRpcConnection(page);
    await page.waitForTimeout(2_000);
    const reconnect = await forceDisconnectAndWaitForReconnect(page);
    const currentCanvasName = 'Reconnect Current';
    const currentCanvas = await createCanvas(page, currentCanvasName);
    assert.notEqual(currentCanvas.id, initialCanvasId, 'Post-reconnect Canvas reused the initial identity.');
    assert.equal(new URL(page.url()).pathname, `/c/${currentCanvas.id}`, 'Visible Canvas creation did not navigate.');
    assert.equal(await page.getByText('Untitled Canvas', { exact: true }).count(), 1);
    assert.equal(await page.getByText(currentCanvasName, { exact: true }).count(), 1);
    const finalTransport = await page.evaluate(() => (
      (window as unknown as {
        __omnidrawBrowserAcceptance: { snapshot(): TTransportEvidence };
      }).__omnidrawBrowserAcceptance.snapshot()
    ));
    const retiredTransport = finalTransport.rpcConnections.find((entry) => (
      entry.id === reconnect.retiredConnectionId
    ));
    assert.equal(retiredTransport?.closed, true, 'The retired native socket remained open.');
    assert.equal(
      retiredTransport?.actualMessagesAfterNewerOpen,
      0,
      'The retired native socket delivered a real server frame after replacement opened.',
    );

    const unexpectedBrowserErrors = browserErrors.filter((message) => !(
      (message.includes('/rpc') && message.includes('WebSocket'))
      || message.includes('SocketCloseError: 4001: browser-acceptance-reconnect')
    ));
    assert.deepEqual(unexpectedBrowserErrors, [], browserErrors.join('\n'));
    assert.deepEqual(badResponses, [], badResponses.join('\n'));
    console.log('[browser:live] 16 routes, durable Arrow endpoints, streamed AI Chat/history, Preview function/resource bridge, visible-first bounded runtime/cache isolation, Preview success/failure usability, restart recovery, and WebSocket fencing passed');
  } finally {
    await page.close();
    await browser.close();
  }
}

const home = await mkdtemp(join(tmpdir(), 'omnidraw-live-browser-home-'));
const reservations = await Promise.all([reservePort(), reservePort()]);
const processes: TManagedProcess[] = [];
const provider = startFakeProvider();

try {
  await seedAgentModel(home, provider.baseUrl);
  const browserTools = await seedDraftWidget(home);
  const backendEnvironment = Object.freeze({
    NODE_ENV: 'production',
    OMNIDRAW_HOME: home,
    OMNIDRAW_VERSION: 'browser-acceptance',
    PATH: `${browserTools}:${process.env.PATH ?? ''}`,
  });
  const [backendPort, frontendPort] = reservations;
  assert.notEqual(backendPort!.port, frontendPort!.port, 'Browser acceptance reserved the same port twice.');

  await backendPort!.release();
  let backend = spawnProcess({
    label: 'backend',
    cwd: BACKEND_ROOT,
    command: [process.execPath, 'src/main.ts', 'serve', '--port', String(backendPort!.port)],
    env: backendEnvironment,
  });
  processes.push(backend);
  await waitForHttp(`http://127.0.0.1:${backendPort!.port}/health`, backend);
  const restartBackend = async (): Promise<void> => {
    await stopProcess(backend);
    backend = spawnProcess({
      label: 'backend-restart',
      cwd: BACKEND_ROOT,
      command: [process.execPath, 'src/main.ts', 'serve', '--port', String(backendPort!.port)],
      env: backendEnvironment,
    });
    processes.push(backend);
    await waitForHttp(`http://127.0.0.1:${backendPort!.port}/health`, backend);
  };

  await frontendPort!.release();
  const frontend = spawnProcess({
    label: 'frontend',
    cwd: FRONTEND_ROOT,
    command: [
      'node',
      VITE_BIN,
      '--host',
      '127.0.0.1',
      '--port',
      String(frontendPort!.port),
      '--strictPort',
      '--force',
    ],
    env: {
      NODE_ENV: 'development',
      OMNIDRAW_BACKEND_HOST: '127.0.0.1',
      OMNIDRAW_BACKEND_PORT: String(backendPort!.port),
      OMNIDRAW_FRONTEND_PORT: String(frontendPort!.port),
    },
  });
  processes.push(frontend);
  const baseUrl = `http://127.0.0.1:${frontendPort!.port}/`;
  await waitForHttp(baseUrl, frontend);
  await runBrowserSuite(baseUrl, restartBackend, provider, home);
  await assert.rejects(
    access(join(home, 'widgets/drafts/browser-unbuilt/node_modules')),
    { code: 'ENOENT' },
    'The host-owned Preview build persisted dependencies in the shared draft.',
  );
} catch (error) {
  await Promise.allSettled(processes.map(stopProcess));
  for (const process of processes) {
    const [stdout, stderr] = await Promise.all([process.stdout, process.stderr]);
    const evidence = `${stdout}\n${stderr}`.trim();
    if (evidence !== '') {
      console.error(`[browser:live] ${process.label} output before failure:\n${evidence.slice(-20_000)}`);
    }
  }
  throw error;
} finally {
  provider.stop();
  await Promise.allSettled(reservations.map((reservation) => reservation.release()));
  await Promise.allSettled(processes.reverse().map(stopProcess));
  await rm(home, { recursive: true, force: true });
}
