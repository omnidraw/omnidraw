import { createHash } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import type { TWidgetFrameNode } from '@omnidraw/cangine';
import { createWidgetPreviewOwner } from '../../src/canvas-extension/preview-owner';

const BYTES = new TextEncoder().encode('widget-bytes');
const DIGEST = createHash('sha256').update(BYTES).digest('hex');
const CAPSULE_HASH = `sha256:${'a'.repeat(64)}` as const;

const ELEMENT = { id: 'node-1' } as TWidgetFrameNode;

function codec() {
  return {
    decodeBase64: (value: string) => Uint8Array.from(Buffer.from(value, 'base64')),
    digestSha256: async (value: Uint8Array) => createHash('sha256').update(value).digest('hex'),
  };
}

function stoppedNotFound(): [Error, undefined] {
  return [Object.assign(new Error('Preview stopped — build again.'), { code: 'NOT_FOUND' }), undefined];
}

function mountView() {
  return {
    canvasId: 'canvas-1',
    elementId: 'node-1',
    widgetKey: 'hello-app',
    artifact: {
      digestSha256: DIGEST,
      byteSize: BYTES.byteLength,
      bytesBase64: Buffer.from(BYTES).toString('base64'),
    },
    runtimeDescriptor: { capsuleArtifactHash: CAPSULE_HASH },
    functionDescriptors: [],
    browserFunctionDescriptorsDigestSha256: '0'.repeat(64),
  };
}

function createHarness(args: Readonly<{ autoBuild?: () => boolean }> = {}) {
  const handle = {
    setViewport: vi.fn(),
    destroy: vi.fn(async () => undefined),
  };
  const transport = {
    api: {
      widget: {
        preview: {
          load: vi.fn(async () => stoppedNotFound()),
          open: vi.fn(async () => [undefined, mountView()]),
          close: vi.fn(async () => [undefined, { closed: true }]),
        },
      },
    },
  };
  const mount = {
    mount: vi.fn(async () => handle),
    destroy: vi.fn(async () => undefined),
  };
  const host = document.createElement('div');
  const owner = createWidgetPreviewOwner({
    transport: transport as never,
    mount: mount as never,
    codec: codec(),
    canvasId: 'canvas-1',
    widgetKey: 'hello-app',
    isTargetCurrent: () => true,
    ...(args.autoBuild === undefined ? {} : { shouldAutoBuild: args.autoBuild }),
  });
  return { handle, host, mount, owner, transport };
}

describe('widget preview owner auto-build', () => {
  test('auto-builds a freshly placed frame when the load reports NOT_FOUND', async () => {
    const { host, mount, owner, transport } = createHarness({ autoBuild: () => true });

    owner.attach(host, ELEMENT);

    await vi.waitFor(() => expect(host.dataset.widgetRuntimeStatus).toBe('ready'));
    expect(transport.api.widget.preview.open).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      elementId: 'node-1',
      widgetKey: 'hello-app',
    });
    expect(mount.mount).toHaveBeenCalledOnce();
    expect(host.textContent).not.toContain('Preview stopped');

    await owner.destroy('test done');
    expect(transport.api.widget.preview.close).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      elementId: 'node-1',
    });
  });

  test('keeps the stopped fallback for a stale session and builds only on demand', async () => {
    const { host, owner, transport } = createHarness();

    owner.attach(host, ELEMENT);

    await vi.waitFor(() => expect(host.dataset.widgetRuntimeStatus).toBe('deferred'));
    expect(host.textContent).toContain('Preview stopped — build again.');
    expect(transport.api.widget.preview.open).not.toHaveBeenCalled();

    const retry = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent === 'Build again');
    expect(retry).not.toBeUndefined();
    retry?.click();
    await vi.waitFor(() => expect(host.dataset.widgetRuntimeStatus).toBe('ready'));
    expect(transport.api.widget.preview.open).toHaveBeenCalledOnce();

    await owner.destroy('test done');
  });

  test('consumes the auto-build once so a remount after a lost session shows the stopped state', async () => {
    let fresh = true;
    const shouldAutoBuild = () => {
      const value = fresh;
      fresh = false;
      return value;
    };
    const first = createHarness({ autoBuild: shouldAutoBuild });
    first.owner.attach(first.host, ELEMENT);
    await vi.waitFor(() => expect(first.host.dataset.widgetRuntimeStatus).toBe('ready'));
    await first.owner.destroy('replaced');

    const second = createHarness({ autoBuild: shouldAutoBuild });
    second.owner.attach(second.host, ELEMENT);
    await vi.waitFor(() => expect(second.host.dataset.widgetRuntimeStatus).toBe('deferred'));
    expect(second.transport.api.widget.preview.open).not.toHaveBeenCalled();
    await second.owner.destroy('test done');
  });
});
