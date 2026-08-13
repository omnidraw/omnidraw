import { afterEach, describe, expect, test } from 'bun:test';
import { createWebFetchTool } from '../tools/tool.web-fetch';
import { executeTool } from './tool.test-helpers';

const servers: Bun.Server<any>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

function serve(routes: Record<string, () => Response | Promise<Response>>): string {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      return routes[path]?.() ?? new Response('not found', { status: 404 });
    },
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

describe('web_fetch', () => {
  test('returns markdown from static HTML and strips noisy tags', async () => {
    const origin = serve({
      '/page': () => new Response(`<!doctype html>
        <html>
          <head>
            <title>Example Page</title>
            <meta name="x" content="noise">
            <link rel="stylesheet" href="/style.css">
            <style>body { color: red; }</style>
          </head>
          <body>
            <script>window.__noise = true;</script>
            <h1>Hello &amp; Welcome</h1>
            <p>Read <a href="/docs">docs</a>.</p>
          </body>
        </html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    });

    const result = await executeTool(createWebFetchTool(), { url: `${origin}/page` });

    expect(result.isError).toBeUndefined();
    expect(result.details.status).toBe(200);
    expect(result.details.title).toBe('Example Page');
    expect(result.details.format).toBe('markdown');
    expect(result.details.content).toContain('# Hello & Welcome');
    expect(result.details.content).toContain('[docs](/docs)');
    expect(result.content[0].text).toContain('Content:');
    expect(result.content[0].text).toContain('# Hello & Welcome');
    expect(result.content[0].text).toContain('[docs](/docs)');
    expect(result.details.content).not.toContain('window.__noise');
    expect(result.details.content).not.toContain('body { color: red; }');
    expect(result.details.truncated).toBe(false);
    expect(result.details.likelySpa).toBe(false);
  });

  test('returns normalized text for plain text responses', async () => {
    const origin = serve({
      '/text': () => new Response('alpha\n\n\n beta', { headers: { 'content-type': 'text/plain' } }),
    });

    const result = await executeTool(createWebFetchTool(), { url: `${origin}/text`, format: 'text' });

    expect(result.isError).toBeUndefined();
    expect(result.details.contentType).toContain('text/plain');
    expect(result.details.content).toBe('alpha\n\nbeta');
    expect(result.details.likelySpa).toBe(false);
  });

  test('returns raw content without HTML conversion', async () => {
    const origin = serve({
      '/raw': () => new Response('<h1>Raw</h1>', { headers: { 'content-type': 'text/html' } }),
    });

    const result = await executeTool(createWebFetchTool(), { url: `${origin}/raw`, format: 'raw' });

    expect(result.isError).toBeUndefined();
    expect(result.details.content).toBe('<h1>Raw</h1>');
  });

  test('enforces maxBytes while streaming', async () => {
    const origin = serve({
      '/large': () => new Response('abcdefghijklmnopqrstuvwxyz', {
        headers: {
          'content-type': 'text/plain',
          'content-length': '26',
        },
      }),
    });

    const result = await executeTool(createWebFetchTool(), { url: `${origin}/large`, format: 'raw', maxBytes: 10 });

    expect(result.isError).toBeUndefined();
    expect(result.details.content).toBe('abcdefghij');
    expect(result.details.truncated).toBe(true);
    expect(result.content[0].text).toContain('Truncated: true');
    expect(result.content[0].text).toContain('Content:\nabcdefghij');
  });

  test('rejects unsupported protocols', async () => {
    const result = await executeTool(createWebFetchTool(), { url: 'file:///etc/passwd' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('only supports http:// and https://');
  });

  test('reports likely SPA app shells without failing', async () => {
    const origin = serve({
      '/app': () => new Response(`<!doctype html>
        <html>
          <head><title>Client App</title></head>
          <body>
            <div id="root"></div>
            <script type="module" src="/assets/index-abcd1234.js"></script>
          </body>
        </html>`, { headers: { 'content-type': 'text/html' } }),
    });

    const result = await executeTool(createWebFetchTool(), { url: `${origin}/app`, format: 'markdown' });

    expect(result.isError).toBeUndefined();
    expect(result.details.title).toBe('Client App');
    expect(result.details.likelySpa).toBe(true);
    expect(result.details.spaReason).toContain('app root');
    expect(result.content[0].text).toContain('Likely SPA: true');
  });

  test('times out bounded requests', async () => {
    const origin = serve({
      '/slow': async () => {
        await Bun.sleep(50);
        return new Response('too late', { headers: { 'content-type': 'text/plain' } });
      },
    });

    const result = await executeTool(createWebFetchTool(), { url: `${origin}/slow`, timeoutMs: 1 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('web_fetch failed');
  });
});
