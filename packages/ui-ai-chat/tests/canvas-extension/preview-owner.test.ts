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
  loadResponses?: ReadonlyArray<readonly [Error | null | undefined, ReturnType<typeof mountView> | undefined]>;
  openResponses?: ReadonlyArray<readonly [Error | null, ReturnType<typeof mountView> | undefined]>;
  rebuildResponses?: ReadonlyArray<readonly [Error | null, ReturnType<typeof mountView> | undefined]>;
}> = {}) {
  const handle = {
    setViewport: vi.fn(),
    destroy: vi.fn(async () => undefined),
  };
  const openResponses = args.openResponses ?? [[undefined, mountView()]];
  const rebuildResponses = args.rebuildResponses ?? [[undefined, mountView()]];
  const loadResponses = args.loadResponses ?? [stoppedNotFound()];
  let openCall = 0;
  let rebuildCall = 0;
  let loadCall = 0;
  const transport = {
    api: {
      widget: {
        preview: {
          load: vi.fn(async () => {
            const response = loadResponses[Math.min(loadCall, loadResponses.length - 1)];
            loadCall += 1;
            return response;
          }),
          open: vi.fn(async () => {
            const response = openResponses[Math.min(openCall, openResponses.length - 1)];
            openCall += 1;
            return response;
          }),
          rebuild: vi.fn(async () => {
            const response = rebuildResponses[
              Math.min(rebuildCall, rebuildResponses.length - 1)
            ];
            rebuildCall += 1;
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
    expect(transport.api.widget.preview.rebuild).toHaveBeenCalledWith({
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
    expect(transport.api.widget.preview.rebuild).not.toHaveBeenCalled();

    const retry = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent === 'Build again');
    expect(retry).not.toBeUndefined();
    retry?.click();
    await vi.waitFor(() => expect(host.dataset.widgetRuntimeStatus).toBe('ready'));
    expect(transport.api.widget.preview.rebuild).toHaveBeenCalledOnce();

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
    expect(second.transport.api.widget.preview.rebuild).not.toHaveBeenCalled();
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

describe('widget preview owner explicit actions', () => {
  test('Reload remounts the live artifact without opening or building a Preview', async () => {
    const { handle, host, mount, owner, transport } = createHarness({
      autoBuild: () => true,
      loadResponses: [stoppedNotFound(), [undefined, mountView()]],
    });
    owner.attach(host, ELEMENT);
    await vi.waitFor(() => expect(host.dataset.widgetRuntimeStatus).toBe('ready'));
    expect(transport.api.widget.preview.rebuild).toHaveBeenCalledOnce();

    await owner.reload();

    expect(transport.api.widget.preview.load).toHaveBeenCalledTimes(2);
    expect(transport.api.widget.preview.rebuild).toHaveBeenCalledOnce();
    expect(mount.mount).toHaveBeenCalledTimes(2);
    expect(handle.destroy).toHaveBeenCalledOnce();
    await owner.destroy('test done');
  });

  test('Reload keeps a stopped Preview stopped and never falls through to open', async () => {
    const { host, owner, transport } = createHarness();
    owner.attach(host, ELEMENT);
    await vi.waitFor(() => expect(host.dataset.widgetRuntimeStatus).toBe('deferred'));

    await owner.reload();

    expect(host.textContent).toContain('Preview stopped — build again.');
    expect(transport.api.widget.preview.load).toHaveBeenCalledTimes(2);
    expect(transport.api.widget.preview.open).not.toHaveBeenCalled();
    await owner.destroy('test done');
  });

  test('Reload releases a mounted runtime when its live session disappeared', async () => {
    const { handle, host, owner } = createHarness({
      loadResponses: [[undefined, mountView()], stoppedNotFound()],
    });
    owner.attach(host, ELEMENT);
    await vi.waitFor(() => expect(host.dataset.widgetRuntimeStatus).toBe('ready'));

    await owner.reload();

    expect(host.dataset.widgetRuntimeStatus).toBe('deferred');
    expect(host.textContent).toContain('Preview stopped — build again.');
    expect(handle.destroy).toHaveBeenCalledOnce();
    await owner.destroy('test done');
    expect(handle.destroy).toHaveBeenCalledOnce();
  });

  test('Rebuild remounts even when construction reuses the mounted digest', async () => {
    const { handle, host, mount, owner, transport } = createHarness({
      autoBuild: () => true,
      rebuildResponses: [
        [undefined, mountView()],
        [undefined, mountView()],
      ],
    });
    owner.attach(host, ELEMENT);
    await vi.waitFor(() => expect(host.dataset.widgetRuntimeStatus).toBe('ready'));

    await owner.rebuild();

    expect(transport.api.widget.preview.rebuild).toHaveBeenCalledTimes(2);
    expect(mount.mount).toHaveBeenCalledTimes(2);
    expect(handle.destroy).toHaveBeenCalledOnce();
    await owner.destroy('test done');
  });

  test('reports an error when replacement mounting destroys the prior runtime and then fails', async () => {
    const harness = createHarness({ autoBuild: () => true });
    harness.owner.attach(harness.host, ELEMENT);
    await vi.waitFor(() => expect(harness.host.dataset.widgetRuntimeStatus).toBe('ready'));
    harness.mount.mount.mockRejectedValueOnce(new Error('Replacement mount failed.'));

    await harness.owner.rebuild();

    expect(harness.handle.destroy).toHaveBeenCalledOnce();
    expect(harness.host.dataset.widgetRuntimeStatus).toBe('error');
    expect(harness.host.textContent).toContain('Replacement mount failed.');
    await harness.owner.destroy('test done');
  });

  test('renders the mapped message from a structured Capsule failure', async () => {
    const harness = createHarness({ autoBuild: () => true });
    harness.mount.mount.mockRejectedValueOnce({
      capsuleCode: 'CAPSULE_RUNTIME_ERROR',
      message: 'Guest startup failed at widget://ui/main.ts:12:4.',
    });

    harness.owner.attach(harness.host, ELEMENT);

    await vi.waitFor(() => expect(harness.host.dataset.widgetRuntimeStatus).toBe('error'));
    expect(harness.host.textContent).toBe(
      'Guest startup failed at widget://ui/main.ts:12:4. (CAPSULE_RUNTIME_ERROR)',
    );
    await harness.owner.destroy('test done');
  });

  test('serializes repeated explicit rebuilds so mounts never overlap', async () => {
    let activeMounts = 0;
    let maximumActiveMounts = 0;
    const harness = createHarness({ autoBuild: () => true });
    harness.mount.mount.mockImplementation(async () => {
      activeMounts += 1;
      maximumActiveMounts = Math.max(maximumActiveMounts, activeMounts);
      await Promise.resolve();
      activeMounts -= 1;
      return harness.handle;
    });
    harness.owner.attach(harness.host, ELEMENT);
    await vi.waitFor(() => expect(harness.host.dataset.widgetRuntimeStatus).toBe('ready'));

    await Promise.all([
      harness.owner.rebuild(),
      harness.owner.rebuild(),
      harness.owner.rebuild(),
    ]);

    expect(maximumActiveMounts).toBe(1);
    expect(harness.mount.mount).toHaveBeenCalledTimes(4);
    await harness.owner.destroy('test done');
  });

  test('closes immediately while an attach load remains in flight', async () => {
    const harness = createHarness();
    let resolveLoad!: (value: readonly [undefined, ReturnType<typeof mountView>]) => void;
    harness.transport.api.widget.preview.load.mockImplementation(() => (
      new Promise((resolve) => {
        resolveLoad = resolve;
      })
    ));
    harness.owner.attach(harness.host, ELEMENT);
    await vi.waitFor(() => (
      expect(harness.transport.api.widget.preview.load).toHaveBeenCalledOnce()
    ));

    let destroyed = false;
    void harness.owner.destroy('removed').then(() => {
      destroyed = true;
    });

    await vi.waitFor(() => expect(destroyed).toBe(true));
    expect(harness.transport.api.widget.preview.close).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      elementId: 'node-1',
    });
    resolveLoad([undefined, mountView()]);
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.mount.mount).not.toHaveBeenCalled();
  });

  test('closes again when an in-flight rebuild opens a session after removal', async () => {
    const harness = createHarness({
      loadResponses: [[undefined, mountView()]],
    });
    harness.owner.attach(harness.host, ELEMENT);
    await vi.waitFor(() => expect(harness.host.dataset.widgetRuntimeStatus).toBe('ready'));
    let resolveRebuild!: (value: readonly [undefined, ReturnType<typeof mountView>]) => void;
    harness.transport.api.widget.preview.rebuild.mockImplementation(() => (
      new Promise((resolve) => {
        resolveRebuild = resolve;
      })
    ));
    void harness.owner.rebuild();
    await vi.waitFor(() => (
      expect(harness.transport.api.widget.preview.rebuild).toHaveBeenCalledOnce()
    ));

    await harness.owner.destroy('removed');
    expect(harness.transport.api.widget.preview.close).toHaveBeenCalledTimes(1);
    resolveRebuild([undefined, mountView()]);

    await vi.waitFor(() => (
      expect(harness.transport.api.widget.preview.close).toHaveBeenCalledTimes(2)
    ));
    expect(harness.mount.mount).toHaveBeenCalledOnce();
  });
});
