import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { mountArrowSandboxBridge } from '../src';

const testRequire = createRequire(import.meta.url);
const arrowSandboxPath = testRequire.resolve('@arrow-js/sandbox');
const quickJsPath = createRequire(arrowSandboxPath).resolve('quickjs-emscripten');
const quickJsWasmPath = createRequire(quickJsPath)
  .resolve('@jitl/quickjs-wasmfile-release-asyncify/wasm');
const quickJsWasm = readFileSync(quickJsWasmPath);
const originalFetch = globalThis.fetch.bind(globalThis);

beforeAll(() => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/emscripten-module.wasm')) {
      return new Response(quickJsWasm, {
        headers: { 'content-type': 'application/wasm' },
        status: 200,
      });
    }
    return originalFetch(input, init);
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function legacyBridge() {
  return {
    getSnapshot: vi.fn(async () => ({
      status: 'running' as const,
      state: 'idle',
      context: {},
    })),
    sendMessage: vi.fn(async () => ({ ok: true as const })),
    subscribeSnapshots: vi.fn(() => () => undefined),
  };
}

async function waitForReady(host: HTMLElement | null) {
  expect(host).not.toBeNull();
  customElements.upgrade?.(host as HTMLElement);
  await vi.waitFor(() => expect(host?.dataset.ready).toBe('true'), { timeout: 10_000 });
}

describe('legacy Arrow sandbox bridge', () => {
  test('preserves widget CSS after the exact trusted host layout', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const cleanup = mountArrowSandboxBridge({ root, onError: vi.fn() }, {
      sources: {
        'main.ts': `
          import { html } from '@arrow-js/core';
          export default html\`<section class="legacy-card">styled legacy widget</section>\`;
        `,
        'main.css': '.legacy-card { color: rebeccapurple; padding: 1rem; }',
      },
      bridge: legacyBridge(),
    });
    const host = root.querySelector('arrow-sandbox') as HTMLElement | null;
    await waitForReady(host);

    const styleText = host?.shadowRoot?.querySelector('style')?.textContent;
    expect(styleText).toContain('/* vibecanvas-trusted-host-layout-v1 */');
    expect(styleText).toContain('.legacy-card { color: rebeccapurple; padding: 1rem; }');
    expect(host?.shadowRoot?.querySelector('section.legacy-card')?.textContent)
      .toContain('styled legacy widget');
    cleanup();
    root.remove();
  });

  test('destroys the controller after a fatal event-dispatch error', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const onError = vi.fn();
    const unsubscribe = vi.fn();
    const bridge = legacyBridge();
    bridge.subscribeSnapshots.mockReturnValue(unsubscribe);
    const cleanup = mountArrowSandboxBridge({ root, onError }, {
      sources: {
        'main.ts': `
          import { html } from '@arrow-js/core';
          export default html\`<button @click="\${() => { throw new Error('legacy dispatch failed'); }}">fail</button>\`;
        `,
      },
      bridge,
    });
    const host = root.querySelector('arrow-sandbox') as HTMLElement | null;
    await waitForReady(host);

    host?.shadowRoot?.querySelector<HTMLButtonElement>('button')?.click();
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('legacy dispatch failed'),
      }));
    }, { timeout: 10_000 });
    expect((host as unknown as { controller: unknown }).controller).toBeNull();
    expect(host?.dataset.ready).toBe('error');
    expect(unsubscribe).toHaveBeenCalledOnce();
    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
    root.remove();
  });
});
