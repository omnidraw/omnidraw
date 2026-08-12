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
  reload(): Promise<void>;
  rebuild(): Promise<void>;
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

function isBuildUnavailable(error: unknown): boolean {
  return error !== null
    && typeof error === 'object'
    && 'code' in error
    && (
      error.code === 'CONFLICT'
      || error.code === 'BUILD_REQUIRED'
      || error.code === 'BUILD_PENDING'
      || error.code === 'BUILD_IMPORT_FAILED'
    );
}

function previewErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  if (
    error !== null
    && typeof error === 'object'
    && 'message' in error
    && typeof error.message === 'string'
    && error.message.trim() !== ''
  ) {
    const code = 'capsuleCode' in error && typeof error.capsuleCode === 'string'
      ? error.capsuleCode
      : null;
    const source = 'source' in error && typeof error.source === 'string'
      ? error.source
      : null;
    const line = 'line' in error && typeof error.line === 'number'
      ? error.line
      : null;
    const location = source === null
      ? ''
      : ` at ${source}${line === null ? '' : `:${line}`}`;
    return `${error.message}${code === null ? '' : ` (${code})`}${location}`;
  }
  return 'Preview failed.';
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
  let operationTail = Promise.resolve();

  const serialize = (operation: () => Promise<void>): Promise<void> => {
    const next = operationTail.then(operation, operation);
    operationTail = next.catch(() => undefined);
    return next;
  };

  const closeSession = async (
    session: Readonly<TWidgetPreviewRuntimeIdentity>,
  ): Promise<void> => {
    await args.transport.api.widget.preview.close({
      canvasId: session.canvasId,
      elementId: session.elementId,
    }).catch(() => undefined);
  };

  const fail = (error: unknown): void => {
    if (disposed || host === null) return;
    host.dataset.widgetRuntimeStatus = 'error';
    host.textContent = previewErrorMessage(error);
    args.onFatal?.(error);
  };

  const releaseMounted = async (reason: string): Promise<void> => {
    const mounted = handle;
    handle = null;
    mountedDigestSha256 = null;
    await mounted?.destroy(reason).catch(() => undefined);
  };

  const renderStopped = async (): Promise<void> => {
    if (disposed || host === null || identity === null) return;
    await releaseMounted('preview session stopped');
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
    await releaseMounted('preview artifact replaced');
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
    const session = identity;
    if (disposed || session === null) throw new PreviewNotBuildableError();
    const [error, response] = await args.transport.api.widget.preview.open({
      canvasId: session.canvasId,
      elementId: session.elementId,
      widgetKey: session.widgetKey,
    });
    if (disposed) {
      // close() may have raced ahead of this server-side open. Close once more
      // after the response so a late-created process session cannot survive.
      await closeSession(session);
      throw new PreviewNotBuildableError();
    }
    if (error || !response) {
      if (isNotFound(error)) {
        await renderStopped();
        throw new PreviewNotBuildableError();
      }
      throw error ?? new Error('Preview build failed.');
    }
    return response;
  };

  const rebuildPreview = async (): Promise<TWidgetPreviewMountResponse> => {
    const session = identity;
    if (disposed || session === null) throw new PreviewNotBuildableError();
    const [error, response] = await args.transport.api.widget.preview.rebuild({
      canvasId: session.canvasId,
      elementId: session.elementId,
      widgetKey: session.widgetKey,
    });
    if (disposed) {
      await closeSession(session);
      throw new PreviewNotBuildableError();
    }
    if (error || !response) throw error ?? new Error('Preview build failed.');
    return response;
  };

  const runRebuild = async (): Promise<void> => {
    if (disposed || host === null || identity === null) return;
    const keepsAcceptedPreview = handle !== null;
    if (!keepsAcceptedPreview) {
      host.dataset.widgetRuntimeStatus = 'loading';
      host.textContent = 'Building Preview…';
    }
    try {
      const response = await rebuildPreview();
      if (disposed || host === null || identity === null) return;
      await mountArtifact(response);
    } catch (error) {
      if (error instanceof PreviewNotBuildableError) return;
      if (keepsAcceptedPreview && handle !== null && host !== null) {
        host.dataset.widgetRuntimeStatus = 'ready';
        args.onFatal?.(error);
        return;
      }
      fail(error);
    }
  };

  const runReload = async (): Promise<void> => {
    if (disposed || host === null || identity === null) return;
    host.dataset.widgetRuntimeStatus = 'loading';
    host.textContent = 'Loading Preview…';
    try {
      const [error, response] = await args.transport.api.widget.preview.load({
        canvasId: identity.canvasId,
        elementId: identity.elementId,
        widgetKey: identity.widgetKey,
      });
      if (error || !response) {
        if (isNotFound(error)) {
          await renderStopped();
          return;
        }
        throw error ?? new Error('Preview runtime is unavailable.');
      }
      await mountArtifact(response);
    } catch (error) {
      fail(error);
    }
  };

  const reload = (): Promise<void> => serialize(runReload);
  const rebuild = (): Promise<void> => serialize(runRebuild);

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
        await serialize(async () => {
          try {
            const response = await openPreview();
            if (disposed || host === null || identity === null) return;
            if (response.artifact.digestSha256 === mountedDigestSha256) {
              // Same construction reused (e.g. restart): the existing widget is
              // still mounted and rendering, so do not touch the host.
              host.dataset.widgetRuntimeStatus = 'ready';
              return;
            }
            await mountArtifact(response);
          } catch (error) {
            if (error instanceof PreviewNotBuildableError) return;
            if (handle !== null && isBuildUnavailable(error)) {
              if (host !== null) host.dataset.widgetRuntimeStatus = 'ready';
              return;
            }
            fail(error);
          }
        });
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
    void serialize(async () => {
      try {
        const [error, response] = await args.transport.api.widget.preview.load({
          canvasId: args.canvasId,
          elementId: element.id,
          widgetKey: args.widgetKey,
        });
        if (error || !response) {
          if (isNotFound(error)) {
            if (args.shouldAutoBuild?.() === true) {
              await runRebuild();
              return;
            }
            await renderStopped();
            return;
          }
          throw error ?? new Error('Preview runtime is unavailable.');
        }
        await mountArtifact(response);
      } catch (error) {
        fail(error);
      }
    });
  };

  return Object.freeze({
    attach,
    setViewport(viewport) {
      void handle?.setViewport(viewport);
    },
    reload,
    rebuild,
    refresh,
    async destroy(reason = 'preview owner destroyed') {
      if (disposed) return;
      disposed = true;
      refreshQueued = false;
      const mounted = handle;
      handle = null;
      mountedDigestSha256 = null;
      const session = identity;
      identity = null;
      const root = host;
      host = null;
      root?.replaceChildren();
      await Promise.all([
        mounted?.destroy(reason).catch(() => undefined),
        session === null ? undefined : closeSession(session),
      ]);
    },
  });
}
