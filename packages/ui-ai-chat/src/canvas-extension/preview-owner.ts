import type { TWidgetFrameNode } from '@omnidraw/cangine';
import type { TWidgetTransportPort } from '../ports';
import { createWidgetFunctionHostBridge } from '../widget-runtime/create-widget-function-host-bridge';
import { fxDecodeAndVerifyUiArtifact } from '../widget-runtime/fx.decode-and-verify-ui-artifact';
import type {
  TWidgetPreviewRuntimeIdentity,
  TWidgetUiArtifactMountPort,
  TWidgetUiRuntimeHandle,
} from '../widget-runtime/interface';

type TWidgetPreviewMountResponse = NonNullable<Awaited<
  ReturnType<TWidgetTransportPort['api']['widget']['preview']['load']>
>[1]>;

type TCreateWidgetPreviewOwnerArgs = Readonly<{
  transport: TWidgetTransportPort;
  mount: TWidgetUiArtifactMountPort;
  codec: Readonly<{
    decodeBase64(value: string): Uint8Array;
    digestSha256(value: Uint8Array): Promise<string>;
  }>;
  canvasId: string;
  widgetKey: string;
  isTargetCurrent(): boolean;
  /**
   * Consume-on-check flag: returns true exactly once for a freshly placed
   * frame so its first attach builds the draft instead of showing the stopped
   * fallback. Absent or false keeps the restart behavior.
   */
  shouldAutoBuild?(): boolean;
  onFatal?(error: unknown): void;
}>;

export type TWidgetPreviewOwner = Readonly<{
  attach(host: HTMLDivElement, element: Readonly<TWidgetFrameNode>): void;
  setViewport(viewport: Parameters<TWidgetUiRuntimeHandle['setViewport']>[0]): void;
  refresh(): Promise<void>;
  destroy(reason?: string): Promise<void>;
}>;

const PREVIEW_STOPPED_MESSAGE = 'Preview stopped — build again.';

class PreviewNotBuildableError extends Error {}

function isNotFound(error: unknown): boolean {
  return error !== null
    && typeof error === 'object'
    && 'code' in error
    && error.code === 'NOT_FOUND';
}

/**
 * One browser owner for a process-owned ephemeral Preview. It mounts the exact
 * signed bytes of the live session; a freshly placed frame auto-builds once,
 * and a lost session shows the stopped state with an explicit build-again
 * action; nothing is recovered across a host restart.
 */
export function createWidgetPreviewOwner(
  args: TCreateWidgetPreviewOwnerArgs,
): TWidgetPreviewOwner {
  let host: HTMLDivElement | null = null;
  let identity: TWidgetPreviewRuntimeIdentity | null = null;
  let handle: TWidgetUiRuntimeHandle | null = null;
  let mountedDigestSha256: string | null = null;
  let disposed = false;
  let refreshRunning = false;
  let refreshQueued = false;

  const fail = (error: unknown): void => {
    if (disposed || host === null) return;
    host.dataset.widgetRuntimeStatus = 'error';
    host.textContent = error instanceof Error ? error.message : 'Preview failed.';
    args.onFatal?.(error);
  };

  const renderStopped = (): void => {
    if (disposed || host === null || identity === null) return;
    const root = host;
    root.dataset.widgetRuntimeStatus = 'deferred';
    root.replaceChildren();
    const container = root.ownerDocument.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';
    container.style.gap = '8px';
    container.style.height = '100%';
    const message = root.ownerDocument.createElement('p');
    message.textContent = PREVIEW_STOPPED_MESSAGE;
    const retry = root.ownerDocument.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Build again';
    retry.addEventListener('click', () => {
      void rebuild();
    });
    container.append(message, retry);
    root.append(container);
  };

  const mountArtifact = async (
    response: TWidgetPreviewMountResponse,
  ): Promise<void> => {
    if (disposed || host === null || identity === null) return;
    const artifact = await fxDecodeAndVerifyUiArtifact({ codec: args.codec }, {
      expectedDigestSha256: response.artifact.digestSha256,
      expectedCapsuleArtifactHash: response.runtimeDescriptor.capsuleArtifactHash,
      bytesBase64: response.artifact.bytesBase64,
      runtimeDescriptor: response.runtimeDescriptor,
    });
    if (disposed || host === null || identity === null) return;
    const functionBridge = createWidgetFunctionHostBridge({
      identity,
      transport: args.transport,
      functionDescriptors: response.functionDescriptors,
      isTargetCurrent: args.isTargetCurrent,
    });
    // Capsule requires the container to be empty before a new mount, so the
    // previous handle must be destroyed first.
    const previous = handle;
    handle = null;
    await previous?.destroy('preview artifact replaced').catch(() => undefined);
    if (disposed || host === null || identity === null) return;
    host.replaceChildren();
    const mounted = await args.mount.mount({
      mode: 'preview',
      root: host,
      identity,
      artifact,
      functionDescriptors: response.functionDescriptors,
      browserFunctionDescriptorsDigestSha256:
        response.browserFunctionDescriptorsDigestSha256,
      functionBridge,
      collaborativeStateBridge: null,
      onFatal: fail,
    });
    if (disposed) {
      await mounted.destroy('preview owner disposed');
      return;
    }
    handle = mounted;
    mountedDigestSha256 = response.artifact.digestSha256;
    host.dataset.widgetRuntimeStatus = 'ready';
  };

  const openPreview = async (): Promise<TWidgetPreviewMountResponse> => {
    const [error, response] = await args.transport.api.widget.preview.open({
      canvasId: identity!.canvasId,
      elementId: identity!.elementId,
      widgetKey: identity!.widgetKey,
    });
    if (error || !response) {
      if (isNotFound(error)) {
        renderStopped();
        throw new PreviewNotBuildableError();
      }
      throw error ?? new Error('Preview build failed.');
    }
    return response;
  };

  const rebuild = async (): Promise<void> => {
    if (disposed || host === null || identity === null) return;
    host.dataset.widgetRuntimeStatus = 'loading';
    host.textContent = 'Building Preview…';
    try {
      const response = await openPreview();
      if (disposed || host === null || identity === null) return;
      await mountArtifact(response);
    } catch (error) {
      if (error instanceof PreviewNotBuildableError) return;
      fail(error);
    }
  };

  /**
   * Rebuilds the live Preview after a draft change. Coalesces concurrent calls:
   * a refresh that arrives while one is in flight is collapsed into a single
   * follow-up run so an AI edit burst produces one final rebuild.
   *
   * The currently mounted widget stays visible while the server (re)builds. A
   * remount only happens when the rebuilt artifact digest actually changes, so
   * a restart that reuses the same construction keeps the existing frame.
   */
  const refresh = async (): Promise<void> => {
    if (disposed || host === null || identity === null) return;
    if (refreshRunning) {
      refreshQueued = true;
      return;
    }
    refreshRunning = true;
    try {
      do {
        refreshQueued = false;
        if (disposed || host === null || identity === null) return;
        try {
          const response = await openPreview();
          if (disposed || host === null || identity === null) return;
          if (response.artifact.digestSha256 === mountedDigestSha256) {
            // Same construction reused (e.g. restart): the existing widget is
            // still mounted and rendering, so do not touch the host.
            host.dataset.widgetRuntimeStatus = 'ready';
            continue;
          }
          await mountArtifact(response);
        } catch (error) {
          if (error instanceof PreviewNotBuildableError) return;
          fail(error);
        }
      } while (refreshQueued);
    } finally {
      refreshRunning = false;
    }
  };

  const attach = (root: HTMLDivElement, element: Readonly<TWidgetFrameNode>): void => {
    if (disposed) return;
    host = root;
    identity = Object.freeze({
      kind: 'draft_preview' as const,
      canvasId: args.canvasId,
      elementId: element.id,
      widgetKey: args.widgetKey,
    });
    root.dataset.widgetRuntimeStatus = 'loading';
    root.textContent = 'Loading Preview…';
    void (async () => {
      try {
        const [error, response] = await args.transport.api.widget.preview.load({
          canvasId: args.canvasId,
          elementId: element.id,
          widgetKey: args.widgetKey,
        });
        if (error || !response) {
          if (isNotFound(error)) {
            if (args.shouldAutoBuild?.() === true) {
              await rebuild();
              return;
            }
            renderStopped();
            return;
          }
          throw error ?? new Error('Preview runtime is unavailable.');
        }
        await mountArtifact(response);
      } catch (error) {
        fail(error);
      }
    })();
  };

  return Object.freeze({
    attach,
    setViewport(viewport) {
      void handle?.setViewport(viewport);
    },
    refresh,
    async destroy(reason = 'preview owner destroyed') {
      if (disposed) return;
      disposed = true;
      const mounted = handle;
      handle = null;
      const session = identity;
      identity = null;
      await mounted?.destroy(reason).catch(() => undefined);
      if (session !== null) {
        await args.transport.api.widget.preview.close({
          canvasId: session.canvasId,
          elementId: session.elementId,
        }).catch(() => undefined);
      }
      host?.replaceChildren();
      host = null;
    },
  });
}
