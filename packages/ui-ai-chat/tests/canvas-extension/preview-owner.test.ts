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
  return mountViewForBytes(BYTES);
}

function mountViewForBytes(bytes: Uint8Array) {
  const digest = createHash('sha256').update(bytes).digest('hex');
  return {
    canvasId: 'canvas-1',
    elementId: 'node-1',
    widgetKey: 'hello-app',
    artifact: {
      digestSha256: digest,
      byteSize: bytes.byteLength,
      bytesBase64: Buffer.from(bytes).toString('base64'),
    },
    runtimeDescriptor: { capsuleArtifactHash: `sha256:${digest}` },
    functionDescriptors: [],
    browserFunctionDescriptorsDigestSha256: '0'.repeat(64),
  };
}

function createHarness(args: Readonly<{
  autoBuild?: () => boolean;
  openResponses?: ReadonlyArray<readonly [Error | null, ReturnType<typeof mountView> | undefined]>;
}> = {}) {
  const handle = {
    setViewport: vi.fn(),
    destroy: vi.fn(async () => undefined),
  };
  const openResponses = args.openResponses ?? [[undefined, mountView()]];
  let openCall = 0;
  const transport = {
    api: {
      widget: {
        preview: {
          load: vi.fn(async () => stoppedNotFound()),
          open: vi.fn(async () => {
            const response = openResponses[Math.min(openCall, openResponses.length - 1)];
            openCall += 1;
            return response;
          }),
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

describe('widget preview owner refresh', () => {
  test('remounts only when the rebuilt artifact digest changes', async () => {
    const refreshed = mountViewForBytes(new TextEncoder().encode('widget-bytes-v2'));
    const { handle, host, mount, owner } = createHarness({
      autoBuild: () => true,
      openResponses: [
        [undefined, mountView()],
        [undefined, mountView()],
        [undefined, refreshed],
      ],
    });

    owner.attach(host, ELEMENT);
    await vi.waitFor(() => expect(host.dataset.widgetRuntimeStatus).toBe('ready'));
    expect(mount.mount).toHaveBeenCalledOnce();
    expect(handle.destroy).not.toHaveBeenCalled();

    await owner.refresh();
    await vi.waitFor(() => expect(host.dataset.widgetRuntimeStatus).toBe('ready'));
    expect(mount.mount).toHaveBeenCalledOnce();
    expect(handle.destroy).not.toHaveBeenCalled();

    await owner.refresh();
    await vi.waitFor(() => expect(mount.mount).toHaveBeenCalledTimes(2));
    expect(handle.destroy).toHaveBeenCalledTimes(1);
    expect(host.dataset.widgetRuntimeStatus).toBe('ready');

    await owner.destroy('test done');
  });

  test('coalesces concurrent refreshes into one final rebuild', async () => {
    const v2 = mountViewForBytes(new TextEncoder().encode('widget-bytes-v2'));
    const { host, mount, owner } = createHarness({
      autoBuild: () => true,
      openResponses: [
        [undefined, mountView()],
        [undefined, v2],
        [undefined, v2],
        [undefined, v2],
      ],
    });

    owner.attach(host, ELEMENT);
    await vi.waitFor(() => expect(host.dataset.widgetRuntimeStatus).toBe('ready'));
    expect(mount.mount).toHaveBeenCalledOnce();

    await Promise.all([owner.refresh(), owner.refresh(), owner.refresh()]);
    await vi.waitFor(() => expect(mount.mount).toHaveBeenCalledTimes(2));
    expect(host.dataset.widgetRuntimeStatus).toBe('ready');

    await owner.destroy('test done');
  });
});
