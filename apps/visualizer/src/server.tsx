import React from 'react';
import { renderToString } from 'react-dom/server';
import { App } from './App';
import { VisualizerRuntime } from './runtime';
import css from './style.css' with { type: 'text' };

const reactFlowCss = await Bun.file(new URL('../node_modules/@xyflow/react/dist/style.css', import.meta.url)).text();
const PORT = 34532;
const runtime = new VisualizerRuntime();
await runtime.start();

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

async function readJson(request: Request): Promise<any> {
  return await request.json().catch(() => ({}));
}

async function clientBundle(): Promise<Response> {
  const result = await Bun.build({
    entrypoints: [new URL('./client.tsx', import.meta.url).pathname],
    target: 'browser',
    format: 'esm',
    minify: false,
    external: [],
  });
  if (!result.success) return new Response(result.logs.map((log) => log.message).join('\n'), { status: 500 });
  const artifact = result.outputs.find((output) => output.kind === 'entry-point') ?? result.outputs[0];
  return new Response(await artifact.text(), { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } });
}

function html(): Response {
  const snapshot = runtime.snapshot();
  const markup = renderToString(<App initialSnapshot={snapshot} />);
  return new Response(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Vibecanvas Actor Visualizer</title>
  <link rel="stylesheet" href="/reactflow.css" />
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <div id="root">${markup}</div>
  <script>window.__VISUALIZER_SNAPSHOT__ = ${JSON.stringify(snapshot).replace(/</g, '\\u003c')};</script>
  <script type="module" src="/client.js"></script>
</body>
</html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function events(): Response {
  let unsubscribe: (() => void) | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (snapshot: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));
      send(runtime.snapshot());
      unsubscribe = runtime.subscribe(send);
    },
    cancel() {
      unsubscribe?.();
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
}

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/') return html();
      if (request.method === 'GET' && url.pathname === '/reactflow.css') return new Response(reactFlowCss, { headers: { 'content-type': 'text/css; charset=utf-8' } });
      if (request.method === 'GET' && url.pathname === '/style.css') return new Response(css, { headers: { 'content-type': 'text/css; charset=utf-8' } });
      if (request.method === 'GET' && url.pathname === '/client.js') return await clientBundle();
      if (request.method === 'GET' && url.pathname === '/api/events') return events();
      if (request.method === 'GET' && url.pathname === '/api/state') return json({ snapshot: runtime.snapshot() });
      if (request.method === 'GET' && url.pathname === '/api/scenarios') return json({ scenarios: (runtime.snapshot() as any).scenarioOptions });
      if (request.method === 'POST' && url.pathname === '/api/source') {
        const body = await readJson(request);
        if (body.mode === 'db') await runtime.loadDbState(body.canvasId ? String(body.canvasId) : null);
        else await runtime.loadScenario(String(body.scenarioId ?? runtime.scenario.id));
        return json({ snapshot: runtime.snapshot() });
      }
      if (request.method === 'POST' && url.pathname === '/api/canvas') {
        const body = await readJson(request);
        await runtime.selectDbCanvas(body.canvasId ? String(body.canvasId) : null);
        return json({ snapshot: runtime.snapshot() });
      }
      if (request.method === 'POST' && url.pathname === '/api/scenario') {
        const body = await readJson(request);
        await runtime.loadScenario(String(body.scenarioId ?? ''));
        return json({ snapshot: runtime.snapshot() });
      }
      if (request.method === 'POST' && url.pathname === '/api/send') {
        const body = await readJson(request);
        await runtime.sendMessage(String(body.actorInstanceId), String(body.eventName), body.payload ?? {});
        return json({ snapshot: runtime.snapshot() });
      }
      if (request.method === 'POST' && url.pathname === '/api/tick') return json({ result: await runtime.tick(), snapshot: runtime.snapshot() });
      if (request.method === 'POST' && url.pathname === '/api/drain') return json({ result: await runtime.drain(), snapshot: runtime.snapshot() });
      return new Response('Not found', { status: 404 });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error), snapshot: runtime.snapshot() }, { status: 500 });
    }
  },
});

console.log(`Actor visualizer listening on http://localhost:${server.port}`);
