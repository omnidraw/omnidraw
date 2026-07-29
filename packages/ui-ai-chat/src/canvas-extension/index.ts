import {
  createEvenOrderKeys,
  orderKeyBetween,
  type TPortalGeometry,
  type TSceneNode,
  type TSerializedSceneCommand,
  type TWidgetFrameNode,
} from '@omnidraw/cangine';
import {
  portalGeometryToCapsuleViewport,
  readPortalContentCssSize,
} from '@omnidraw/cangine/integrations/capsule';
import type { IWidgetInteractionController } from '@omnidraw/cangine/editor';
import type { ICanvasRuntimeExtension } from '@vibecanvas/canvas';
import { CANVAS_SYNTHETIC_CONTENT_LAYER_ID } from '@vibecanvas/canvas-contract';
import type { TWidgetDraftSummary } from '@vibecanvas/orpc-client';
import { fnCreateChatId } from '@vibecanvas/shared-functions/chat/fn.chat-id';
import type { TWidgetFrameBounds, TWidgetPlacementRef } from '@vibecanvas/widget-contract';
import { render } from 'solid-js/web';
import { AiChat } from '../chat/components';
import type { TChatWidgetDraftReference } from '../chat/components/tabs/fn.tool-call';
import type {
  TAiChatApiPort,
  TAiChatApplicationPort,
  TAiChatBrowserPort,
  TWidgetBrowserPort,
  TWidgetTransportPort,
} from '../ports';
import type {
  TWidgetPlacementCoordinator,
} from '../widget-placement/WidgetPlacementCoordinator';
import { createWidgetPlacementCoordinator } from '../widget-placement/WidgetPlacementCoordinator';
import {
  fnValidateDirectPublishedWidgetPlacement,
  fnValidateWidgetPlacementDescriptor,
} from '../widget-placement/fn.validate-widget-placement-descriptor';
import { txCreateWidgetPointerPlacement } from '../widget-placement/tx.pointer-placement';
import {
  PreviewPublicationConfirmationDialog,
} from '../publication/PreviewPublicationConfirmationDialog';
import type {
  TWidgetTitleBarActionState,
  TWidgetTitleBarPortal,
} from '../widget/interface';
import { CapsuleWidgetHostCoordinator } from '../widget-runtime/CapsuleWidgetHostCoordinator';
import {
  fnWidgetRuntimeLocalTargetMatchesElement,
} from '../widget-runtime/fn.runtime-identity';
import type {
  TWidgetCapsuleHostCatalog,
  TWidgetCapsuleOutputSink,
  TWidgetCapsuleThemeSource,
  TWidgetCollaborativeStatePort,
  TWidgetUiRuntimeRenderOwner,
} from '../widget-runtime/interface';
import { createWidgetUiArtifactMountPort } from '../widget-runtime/mount-widget-ui-artifact';
import { WidgetUiRuntime } from '../widget-runtime/WidgetUiRuntime';
import {
  fnAiWidgetPayload,
  fnCanvasWidgetExtension,
  fnCanvasWidgetMountSignature,
  fnCreateAiWidgetNode,
  fnCreatePreviewWidgetNode,
  fnCreatePublishedWidgetNode,
  fnPreviewWidgetPayload,
  type TAiWidgetPayload,
  type TPreviewWidgetPayload,
} from './fn.canvas-widget';
import {
  fnPreviewControlPresentation,
  type TWidgetDropdownItemPresentation,
} from './fn.preview-control-presentation';
import { fxWidgetCapsuleViewport } from './fx.capsule-portal-viewport';
import { txPersistAiWidgetPayload } from './tx.ai-widget-payload';
import {
  createPreviewPortalRuntime,
  type TPreviewDraftFence,
  type TPreviewPortalRuntime,
} from './PreviewPortalRuntime';

type TLegacyDropdownPresentationController = IWidgetInteractionController & {
  clearDropdownItemPresentation?(widgetId: string): void;
  setDropdownItemPresentation?(
    widgetId: string,
    itemId: string,
    presentation: Readonly<Record<string, TWidgetDropdownItemPresentation>>,
  ): void;
};

function clearDropdownItemPresentation(
  widgets: IWidgetInteractionController,
  widgetId: string,
): void {
  (widgets as TLegacyDropdownPresentationController)
    .clearDropdownItemPresentation?.(widgetId);
}

function setDropdownItemPresentation(
  widgets: IWidgetInteractionController,
  widgetId: string,
  itemId: string,
  presentation: Readonly<Record<string, TWidgetDropdownItemPresentation>>,
): void {
  (widgets as TLegacyDropdownPresentationController)
    .setDropdownItemPresentation?.(widgetId, itemId, presentation);
}

export type TCreateAiChatCanvasExtensionArgs = {
  chatApi: TAiChatApiPort;
  widgetTransport: TWidgetTransportPort;
  chatBrowser: TAiChatBrowserPort;
  widgetBrowser: TWidgetBrowserPort;
  application: TAiChatApplicationPort;
  widgetCapsuleHostCatalog():
    TWidgetCapsuleHostCatalog | Promise<TWidgetCapsuleHostCatalog>;
  widgetCapsuleTheme: TWidgetCapsuleThemeSource;
  widgetCapsuleOutput: TWidgetCapsuleOutputSink;
  widgetPlacement?: TWidgetPlacementCoordinator;
  widgetCollaborativeState?: TWidgetCollaborativeStatePort;
};

type TPortalRegistration = {
  signature: string;
  unregister(): void;
};

type TLocalTitleBarPortal = TWidgetTitleBarPortal & Readonly<{
  sync(): void;
  destroy(): void;
}>;

type TPreviewOwner = NonNullable<
  Awaited<
    ReturnType<
      TAiChatApiPort['api']['agent']['widgetPreview']['owner']['ensure']
    >
  >[1]
>;

const PREVIEW_FRAME_GAP = 24;
const PREVIEW_FRAME_MIN_WIDTH = 480;
const PREVIEW_FRAME_MIN_HEIGHT = 320;
const PREVIEW_EVENT_RECONNECT_DELAYS_MS = Object.freeze([
  250,
  1_000,
  4_000,
  10_000,
]);

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  if (
    error !== null
    && typeof error === 'object'
    && 'message' in error
    && typeof error.message === 'string'
    && error.message.trim().length > 0
  ) {
    return error.message.trim();
  }
  return fallback;
}

function createAiSessionId(args: TCreateAiChatCanvasExtensionArgs): string {
  return fnCreateChatId({
    now: args.widgetBrowser.nowDate(),
    uuid: args.widgetBrowser.createId(),
  });
}

function widgetFrame(
  node: Readonly<TSceneNode> | null,
): Readonly<TWidgetFrameNode> | null {
  return node?.kind === 'widget-frame' ? node : null;
}

function createTitleBarPortal(
  handlers: Map<string, () => void>,
  args: Readonly<{
    document: Document;
    widgetId: string;
    schedule(callback: () => void, timeout: number): unknown;
    cancelSchedule(timer: unknown): void;
  }>,
): TLocalTitleBarPortal {
  const states = new Map<string, TWidgetTitleBarActionState>();
  let syncTimer: unknown;
  let disposed = false;
  const applyStates = (): void => {
    if (disposed) return;
    for (const button of args.document.querySelectorAll<HTMLButtonElement>(
      'button[data-widget-node-id][data-widget-control-part]',
    )) {
      if (button.dataset.widgetNodeId !== args.widgetId) continue;
      const part = button.dataset.widgetControlPart;
      if (part === undefined || !part.startsWith('header-item:')) continue;
      const state = states.get(part.slice('header-item:'.length));
      if (state === undefined) continue;
      button.hidden = state.hidden === true;
      button.disabled = state.disabled === true;
      button.style.cursor = button.disabled ? 'default' : 'pointer';
      button.style.opacity = button.disabled ? '0.45' : '1';
      if (state.pressed === undefined) {
        button.removeAttribute('aria-pressed');
      } else {
        button.setAttribute('aria-pressed', String(state.pressed));
      }
      if (state.label !== undefined) {
        button.setAttribute('aria-label', state.label);
      }
      if (
        state.content !== undefined
        && button.closest('[data-vibecanvas-widget-titlebar]') !== null
      ) {
        button.textContent = state.content;
      }
    }
  };
  const scheduleSync = (): void => {
    if (disposed || syncTimer !== undefined) return;
    syncTimer = args.schedule(() => {
      syncTimer = undefined;
      applyStates();
    }, 0);
  };
  const sync = (): void => {
    applyStates();
    scheduleSync();
  };
  return {
    onAction(id, handler) {
      handlers.set(id, handler);
      return () => {
        if (handlers.get(id) === handler) handlers.delete(id);
      };
    },
    setActionState(id, state) {
      states.set(id, Object.freeze({ ...state }));
      sync();
    },
    sync,
    destroy() {
      if (disposed) return;
      disposed = true;
      if (syncTimer !== undefined) {
        args.cancelSchedule(syncTimer);
        syncTimer = undefined;
      }
      states.clear();
    },
  };
}

export function createAiChatCanvasExtension(
  args: TCreateAiChatCanvasExtensionArgs,
): ICanvasRuntimeExtension {
  return {
    name: 'ai-chat',
    createWidgetNodes({ creation }) {
      const bounds = creation.draft.worldBounds;
      return [fnCreateAiWidgetNode({
        id: creation.nodeId,
        parentId: creation.parentId,
        orderKey: '',
        position: { x: bounds.minX, y: bounds.minY },
        size: {
          width: Math.max(360, bounds.maxX - bounds.minX),
          height: Math.max(280, bounds.maxY - bounds.minY),
        },
        title: 'AI Chat',
        sessionId: createAiSessionId(args),
      })];
    },
    async install(context) {
      const placementCoordinator = args.widgetPlacement
        ?? createWidgetPlacementCoordinator();
      const capsuleHost = new CapsuleWidgetHostCoordinator({
        document: args.widgetBrowser.document,
        catalog: args.widgetCapsuleHostCatalog,
      });
      const widgetMount = createWidgetUiArtifactMountPort({
        coordinator: capsuleHost,
        createStreamId: args.widgetBrowser.createId,
        digestSha256: args.widgetBrowser.digestSha256,
        nowMs: args.widgetBrowser.now,
        theme: args.widgetCapsuleTheme,
        output: args.widgetCapsuleOutput,
      });
      const waitForWidgetRuntime = (
        timeoutMs: number,
        signal?: AbortSignal,
      ): Promise<void> => new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error('Widget runtime wait was cancelled.'));
          return;
        }
        const timer = args.widgetBrowser.setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, timeoutMs);
        const onAbort = () => {
          args.widgetBrowser.clearTimeout(timer);
          reject(new Error('Widget runtime wait was cancelled.'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      const widgetRuntime = new WidgetUiRuntime({
        transport: args.widgetTransport,
        codec: {
          decodeBase64: args.widgetBrowser.decodeBase64,
          digestSha256: args.widgetBrowser.digestSha256,
        },
        mount: widgetMount,
        createIdempotencyKey: args.widgetBrowser.createId,
        organizationId: args.widgetBrowser.organizationId,
        tenantAuthorityKey: args.widgetBrowser.tenantAuthorityKey,
        nowMs: args.widgetBrowser.now,
        scheduleTimeout: args.widgetBrowser.setTimeout,
        cancelTimeout: args.widgetBrowser.clearTimeout,
        wait: waitForWidgetRuntime,
        collaborativeState: args.widgetCollaborativeState,
        isTargetCurrent: (target) => {
          if (target.canvasId !== context.config.canvasId) return false;
          const node = widgetFrame(context.engine.scene.get(target.elementId));
          return node !== null
            && fnWidgetRuntimeLocalTargetMatchesElement(target, node);
        },
      });
      const capsuleViewportPortal = {
        portalGeometryToCapsuleViewport,
        readPortalContentCssSize,
      };

      const actionHandlers = new Map<string, Map<string, () => void>>();
      const registrations = new Map<string, TPortalRegistration>();
      const previewRuntimes = new Map<string, TPreviewPortalRuntime>();
      const previewPublicationDialogs = new Map<string, () => void>();
      const latestPreviewDraftFences = new Map<string, TPreviewDraftFence>();
      let previewOwnerSnapshot = new Map<string, TPreviewWidgetPayload>();
      let previewOwnerSnapshotInitialized = false;
      let companionOperation: Promise<void> = Promise.resolve();
      let previewEventStreamDisposed = false;
      let closePreviewEventStream: (() => void) | null = null;
      let previewEventReconnectTimer: unknown;
      let resolvePreviewEventReconnectDelay: (() => void) | null = null;

      const reportPreviewDraftFence = (
        fence: TPreviewDraftFence,
      ): 'advanced' | 'same' | 'rejected' => {
        const previous = latestPreviewDraftFences.get(fence.draftId);
        if (
          previous !== undefined
          && (
            fence.buildSequence < previous.buildSequence
            || (
              fence.buildSequence === previous.buildSequence
              && (
                fence.revision !== previous.revision
                || fence.committedMutationId !== previous.committedMutationId
              )
            )
            || (
              fence.committedMutationId === previous.committedMutationId
              && (
                fence.revision !== previous.revision
                || fence.buildSequence !== previous.buildSequence
              )
            )
          )
        ) return 'rejected';
        const result = previous !== undefined ? 'same' : 'advanced';
        const advanced = previous === undefined
          || fence.buildSequence > previous.buildSequence;
        if (advanced) {
          latestPreviewDraftFences.set(
            fence.draftId,
            Object.freeze({ ...fence }),
          );
        }
        for (const [frameNodeId, payload] of previewOwnerSnapshot) {
          if (payload.draftId !== fence.draftId) continue;
          previewRuntimes.get(frameNodeId)?.reportDraftFence(fence);
        }
        return advanced ? 'advanced' : result;
      };

      const invalidatePreviewDraftFences = (): void => {
        previewRuntimes.forEach((runtime) => runtime.invalidateDraftFence());
      };

      const closePreviewPublicationDialog = (frameNodeId: string): void => {
        previewPublicationDialogs.get(frameNodeId)?.();
      };

      const openPreviewPublicationDialog = (
        node: Readonly<TWidgetFrameNode>,
        runtime: TPreviewPortalRuntime,
      ): void => {
        const selection = runtime.publicationSelection();
        if (selection === null) {
          context.config.notification?.showError(
            'Preview is not ready to publish',
            'Wait for the current build to complete, then review this frame before publishing.',
          );
          return;
        }
        closePreviewPublicationDialog(node.id);
        const host = args.widgetBrowser.document.createElement('div');
        host.dataset.previewPublicationDialogFor = node.id;
        args.widgetBrowser.document.body.append(host);
        let closed = false;
        let disposeDialog: () => void = () => undefined;
        const close = () => {
          if (closed) return;
          closed = true;
          if (previewPublicationDialogs.get(node.id) === close) {
            previewPublicationDialogs.delete(node.id);
          }
          disposeDialog();
          host.remove();
        };
        previewPublicationDialogs.set(node.id, close);
        const publicationIdempotencyKey = args.widgetBrowser.createId();
        const widgetTitle = node.title ?? 'Widget Preview';
        const widgetName = widgetTitle.endsWith(' Preview')
          ? widgetTitle.slice(0, -' Preview'.length)
          : widgetTitle;
        disposeDialog = render(() => PreviewPublicationConfirmationDialog({
          widgetName,
          selection,
          currentSelection: runtime.publicationSelection,
          confirm: async (confirmedSelection) => {
            const published = await runtime.publish(
              confirmedSelection,
              publicationIdempotencyKey,
            );
            if (published) {
              context.config.notification?.showSuccess(
                `${widgetName} published`,
              );
            }
            return published;
          },
          onOpenChange(open) {
            if (!open) close();
          },
        }), host);
      };

      const ensurePreviewOwner = async (request: Readonly<{
        previewId: string;
        frameNodeId: string;
        draftId: string;
        originChatId: string;
        role: 'companion' | 'placed';
      }>): Promise<TPreviewOwner> => {
        const [ownerError, owner] =
          await args.chatApi.api.agent.widgetPreview.owner.ensure({
            ...request,
            canvasId: context.config.canvasId,
          });
        if (ownerError || !owner) {
          throw new Error(errorMessage(
            ownerError,
            'Could not establish the durable Preview owner.',
          ));
        }
        if (
          owner.canvasId !== context.config.canvasId
          || owner.draftId !== request.draftId
          || owner.originChatId !== request.originChatId
          || owner.role !== request.role
          || owner.status === 'closed'
        ) {
          throw new Error('Preview owner resolution returned a different durable owner.');
        }
        return owner;
      };

      const closePreviewOwner = async (
        previewId: string,
        frameNodeId: string,
      ): Promise<boolean> => {
        const [closeError, closed] =
          await args.chatApi.api.agent.widgetPreview.owner.close({
            previewId,
            canvasId: context.config.canvasId,
            frameNodeId,
          });
        if (closeError) {
          throw new Error(errorMessage(
            closeError,
            'Could not close the durable Preview owner.',
          ));
        }
        return closed === true;
      };

      const durableOwnerHasLiveFrame = (
        owner: TPreviewOwner,
      ): boolean => {
        if (
          owner.canvasId !== context.config.canvasId
          || owner.status === 'closed'
        ) return false;
        const frame = widgetFrame(context.engine.scene.get(owner.frameNodeId));
        const payload = fnPreviewWidgetPayload(frame);
        return frame !== null
          && payload?.previewId === owner.id
          && payload.draftId === owner.draftId
          && payload.originChatId === owner.originChatId
          && payload.role === owner.role;
      };

      const reconcileDurablePreviewOwners = async (): Promise<void> => {
        let listed: Awaited<ReturnType<
          TAiChatApiPort['api']['agent']['widgetPreview']['owner']['list']
        >>;
        try {
          listed = await args.chatApi.api.agent.widgetPreview.owner.list({
            canvasId: context.config.canvasId,
            includeClosed: false,
          });
        } catch (error) {
          args.application.logError(error);
          return;
        }
        const [listError, owners] = listed;
        if (listError || !owners) {
          args.application.logError(
            listError
            ?? new Error('Durable Preview owners could not be reconciled.'),
          );
          return;
        }
        for (const owner of owners) {
          // Re-read the current scene after the owner-list await and after
          // each preceding close. A restored exact frame keeps its owner.
          if (
            owner.canvasId !== context.config.canvasId
            || owner.status === 'closed'
            || durableOwnerHasLiveFrame(owner)
          ) continue;
          try {
            await closePreviewOwner(owner.id, owner.frameNodeId);
          } catch (error) {
            args.application.logError(error);
          }
        }
      };

      const resolveDurableDraft = async (
        reference: TChatWidgetDraftReference,
      ): Promise<TWidgetDraftSummary> => {
        let draftId = reference.draftId;
        if (draftId === undefined) {
          const [listError, drafts] = await args.chatApi.api.agent.widgetDraft.list({});
          if (listError || !drafts) {
            throw new Error(errorMessage(
              listError,
              'Could not list widget drafts.',
            ));
          }
          const matches = drafts.filter((draft) => draft.name === reference.name);
          if (matches.length !== 1) {
            throw new Error(
              matches.length === 0
                ? `Widget draft '${reference.name}' was not found.`
                : `Widget draft name '${reference.name}' is ambiguous.`,
            );
          }
          draftId = matches[0]!.draftId;
        }
        const [getError, draft] = await args.chatApi.api.agent.widgetDraft.get({
          draftId,
        });
        if (getError) {
          throw new Error(errorMessage(getError, 'Could not read the widget draft.'));
        }
        if (draft === null || draft === undefined) {
          throw new Error(`Widget draft '${reference.name}' was not found.`);
        }
        if (draft.draftId !== draftId || draft.name !== reference.name) {
          throw new Error('The widget draft identity changed before Preview opened.');
        }
        if (
          typeof draft.chatId !== 'string'
          || draft.chatId.trim().length === 0
        ) {
          throw new Error('The widget draft has no durable originating chat.');
        }
        return draft;
      };

      const appendWidgetNode = (
        node: TWidgetFrameNode,
        source: string,
      ): void => {
        const siblings = context.engine.scene.childrenOf(node.parentId);
        const commands: TSerializedSceneCommand[] = [];
        let orderKey = orderKeyBetween(siblings.at(-1)?.orderKey ?? null, null);
        if (orderKey === null) {
          const keys = createEvenOrderKeys(siblings.length + 1);
          for (let index = 0; index < siblings.length; index += 1) {
            commands.push({
              type: 'upsert',
              node: { ...siblings[index]!, orderKey: keys[index]! },
            });
          }
          orderKey = keys.at(-1)!;
        }
        commands.push({
          type: 'upsert',
          node: { ...node, orderKey },
        });
        context.editor.commitSceneMutation({ source, commands });
        context.editor.setSelection(
          [node.id],
          { focusedNodeId: node.id },
        );
      };

      const findCompanionPreview = (
        draftId: string,
        originChatId: string,
      ): Readonly<TWidgetFrameNode> | null => {
        const match = context.engine.scene.query((candidate) => {
          const payload = fnPreviewWidgetPayload(candidate);
          return payload?.role === 'companion'
            && payload.draftId === draftId
            && payload.originChatId === originChatId;
        })[0];
        return widgetFrame(match ?? null);
      };

      const openCompanionPreview = (
        originNodeId: string,
        reference: TChatWidgetDraftReference,
      ): Promise<void> => {
        const open = async (): Promise<void> => {
          const draft = await resolveDurableDraft(reference);
          const existing = findCompanionPreview(draft.draftId, draft.chatId);
          if (existing !== null) {
            context.editor.setSelection(
              [existing.id],
              { focusedNodeId: existing.id },
            );
            void previewRuntimes.get(existing.id)?.refresh();
            return;
          }
          const origin = widgetFrame(context.engine.scene.get(originNodeId));
          if (origin === null || fnAiWidgetPayload(origin) === null) {
            throw new Error(
              'The originating AI Chat frame is no longer available.',
            );
          }
          const originWorldBounds = context.engine.geometry.worldBounds(origin.id);
          if (originWorldBounds === null) {
            throw new Error(
              'The originating AI Chat frame has no usable world bounds.',
            );
          }
          const worldPosition = {
            x: originWorldBounds.maxX + PREVIEW_FRAME_GAP,
            y: originWorldBounds.minY,
          };
          const position = origin.parentId === null
            ? worldPosition
            : context.engine.geometry.worldToLocal(
                origin.parentId,
                worldPosition,
              );
          if (position === null) {
            throw new Error(
              'The Preview position could not be mapped beside AI Chat.',
            );
          }
          const requestedFrameId = args.widgetBrowser.createId();
          const requestedPreviewId = args.widgetBrowser.createId();
          let owner = await ensurePreviewOwner({
            previewId: requestedPreviewId,
            frameNodeId: requestedFrameId,
            draftId: draft.draftId,
            originChatId: draft.chatId,
            role: 'companion',
          });
          if (
            owner.id !== requestedPreviewId
            || owner.frameNodeId !== requestedFrameId
          ) {
            const canonical = widgetFrame(
              context.engine.scene.get(owner.frameNodeId),
            );
            const canonicalPayload = fnPreviewWidgetPayload(canonical);
            if (
              canonical !== null
              && canonicalPayload?.previewId === owner.id
              && canonicalPayload.draftId === draft.draftId
              && canonicalPayload.originChatId === draft.chatId
              && canonicalPayload.role === 'companion'
            ) {
              context.editor.setSelection(
                [canonical.id],
                { focusedNodeId: canonical.id },
              );
              void previewRuntimes.get(canonical.id)?.refresh();
              return;
            }
            if (!await closePreviewOwner(owner.id, owner.frameNodeId)) {
              throw new Error('The stale canonical Preview owner could not be closed.');
            }
            owner = await ensurePreviewOwner({
              previewId: requestedPreviewId,
              frameNodeId: requestedFrameId,
              draftId: draft.draftId,
              originChatId: draft.chatId,
              role: 'companion',
            });
          }
          if (
            owner.id !== requestedPreviewId
            || owner.frameNodeId !== requestedFrameId
          ) {
            throw new Error('Preview companion ownership changed before placement.');
          }
          appendWidgetNode(fnCreatePreviewWidgetNode({
            id: owner.frameNodeId,
            parentId: origin.parentId,
            orderKey: '',
            position,
            size: {
              width: Math.max(PREVIEW_FRAME_MIN_WIDTH, origin.size.width),
              height: Math.max(PREVIEW_FRAME_MIN_HEIGHT, origin.size.height),
            },
            title: `${draft.displayName} Preview`,
            previewId: owner.id,
            draftId: draft.draftId,
            originChatId: draft.chatId,
            role: 'companion',
          }), 'vibecanvas:preview-open');
        };
        const queued = companionOperation.then(open, open);
        companionOperation = queued.then(
          () => undefined,
          () => undefined,
        );
        return queued;
      };

      const persistAiPayload = (
        nodeId: string,
        payload: TAiWidgetPayload,
      ): void => {
        const current = widgetFrame(context.engine.scene.get(nodeId));
        if (current === null) return;
        txPersistAiWidgetPayload({ editor: context.editor }, {
          node: current,
          payload,
        });
      };

      const mountAiWidget = (
        root: HTMLDivElement,
        node: Readonly<TWidgetFrameNode>,
      ): (() => void) => {
        root.replaceChildren();
        const storedPayload = fnAiWidgetPayload(node) ?? {};
        const initialSessionId = typeof storedPayload.sessionId === 'string'
          && storedPayload.sessionId.length > 0
          ? storedPayload.sessionId
          : createAiSessionId(args);
        let currentSessionId = initialSessionId;
        if (storedPayload.sessionId !== initialSessionId) {
          persistAiPayload(node.id, { sessionId: initialSessionId });
        }
        const handlers = new Map<string, () => void>();
        actionHandlers.set(node.id, handlers);
        const titleBar = createTitleBarPortal(handlers, {
          document: args.widgetBrowser.document,
          widgetId: node.id,
          schedule: args.widgetBrowser.setTimeout,
          cancelSchedule: args.widgetBrowser.clearTimeout,
        });
        const dispose = render(() => AiChat({
          apiService: args.chatApi,
          application: args.application,
          browser: args.chatBrowser,
          id: node.id,
          titleBar,
          sessionId: initialSessionId,
          aiChatPreference: storedPayload,
          onAiChatPreferenceChange: (preference) => {
            persistAiPayload(node.id, {
              ...preference,
              sessionId: currentSessionId,
            });
          },
          onResetSessionId: () => {
            const sessionId = createAiSessionId(args);
            currentSessionId = sessionId;
            persistAiPayload(node.id, {
              ...storedPayload,
              sessionId,
            });
            return sessionId;
          },
          onOpenWidgetPreview: async (
            reference: TChatWidgetDraftReference,
          ) => {
            await openCompanionPreview(node.id, reference);
          },
        }), root);
        return () => {
          actionHandlers.delete(node.id);
          titleBar.destroy();
          dispose();
          root.replaceChildren();
        };
      };

      const mountPreviewWidget = (
        root: HTMLDivElement,
        node: Readonly<TWidgetFrameNode>,
      ): TPreviewPortalRuntime | null => {
        const payload = fnPreviewWidgetPayload(node);
        if (payload === null) {
          root.textContent = 'This Preview frame has an invalid persisted identity.';
          return null;
        }
        const previous = previewRuntimes.get(node.id);
        if (previous !== undefined) {
          closePreviewPublicationDialog(node.id);
          void previous.destroy('preview-remounted');
        }
        clearDropdownItemPresentation(context.widgets, node.id);
        const handlers = new Map<string, () => void>();
        const runtime = createPreviewPortalRuntime({
          root,
          payload,
          canvasId: context.config.canvasId,
          frameNodeId: node.id,
          api: args.chatApi.api.agent.widgetPreview,
          publishApi: args.chatApi.api.agent.widgetPublish,
          codec: {
            decodeBase64: args.widgetBrowser.decodeBase64,
            digestSha256: args.widgetBrowser.digestSha256,
          },
          mount: widgetMount,
          runtime: widgetRuntime,
          requestFrame: args.chatBrowser.requestAnimationFrame,
          cancelFrame: args.chatBrowser.cancelAnimationFrame,
          nowMs: args.widgetBrowser.now,
          functions: {
            transport: args.widgetTransport,
            organizationId: args.widgetBrowser.organizationId,
            createIdempotencyKey: args.widgetBrowser.createId,
            createLeaseId: args.widgetBrowser.createId,
            scheduleTimeout: args.widgetBrowser.setTimeout,
            cancelTimeout: args.widgetBrowser.clearTimeout,
            wait: waitForWidgetRuntime,
            isTargetCurrent(identity) {
              if (
                identity.orgId !== args.widgetBrowser.organizationId()
                || identity.canvasId !== context.config.canvasId
                || identity.elementId !== node.id
                || identity.widgetInstanceId !== payload.previewId
              ) return false;
              const current = widgetFrame(context.engine.scene.get(node.id));
              const currentPayload = fnPreviewWidgetPayload(current);
              return current !== null
                && actionHandlers.get(node.id) === handlers
                && currentPayload?.previewId === payload.previewId
                && currentPayload.draftId === payload.draftId
                && currentPayload.originChatId === payload.originChatId
                && currentPayload.role === payload.role;
            },
          },
          onControlStateChange(state) {
            setDropdownItemPresentation(
              context.widgets,
              node.id,
              'manage',
              fnPreviewControlPresentation({
                liveUpdatesPaused: state.liveUpdatesPaused,
                pendingBuild: state.pendingBuild !== null,
                publishable: state.publishable,
              }),
            );
          },
          onError: args.application.logError,
        });
        handlers.set('live-updates', () => {
          if (runtime.controlState().liveUpdatesPaused) {
            void runtime.resumeLiveUpdates();
            return;
          }
          runtime.pauseLiveUpdates();
        });
        handlers.set('cancel-build', () => {
          if (runtime.controlState().pendingBuild === null) return;
          void runtime.cancelBuild()
            .then((cancelled) => {
              if (!cancelled) return;
              context.config.notification?.showSuccess(
                'Preview build cancelled',
              );
            })
            .catch((error) => {
              context.config.notification?.showError(
                'Could not cancel Preview build',
                errorMessage(error, 'The current Preview build could not be cancelled.'),
              );
              args.application.logError(error);
            });
        });
        handlers.set('retry', () => {
          void runtime.refresh();
        });
        handlers.set('reset', () => {
          void runtime.reset();
        });
        handlers.set('publish', () => {
          if (!runtime.controlState().publishable) return;
          openPreviewPublicationDialog(node, runtime);
        });
        actionHandlers.set(node.id, handlers);
        previewRuntimes.set(node.id, runtime);
        const latestDraftFence = latestPreviewDraftFences.get(payload.draftId);
        if (latestDraftFence !== undefined) {
          runtime.reportDraftFence(latestDraftFence);
        }
        return runtime;
      };

      const registerPortal = (
        node: Readonly<TWidgetFrameNode>,
      ): TPortalRegistration | null => {
        const extension = fnCanvasWidgetExtension(node);
        const portalId = node.portal?.portalId;
        if (extension === null || portalId === undefined) return null;
        let geometry: TPortalGeometry | null = null;
        let visible = true;
        let portalHost: HTMLElement | null = null;
        let owner: TWidgetUiRuntimeRenderOwner | null = null;
        const updateViewport = () => {
          owner?.setViewport(fxWidgetCapsuleViewport(capsuleViewportPortal, {
            host: portalHost,
            geometry,
            visible,
          }));
        };
        const unregister = context.engine.portals.register({
          portalId,
          mount({ host }) {
            const current = widgetFrame(context.engine.scene.get(node.id));
            if (current === null) return undefined;
            const currentExtension = fnCanvasWidgetExtension(current);
            if (currentExtension?.type === 'ui-widget') {
              if (currentExtension.kind === 'ai') {
                return mountAiWidget(host, current);
              }
              if (currentExtension.kind !== 'preview') {
                host.textContent = `Unsupported widget kind: ${currentExtension.kind}`;
                return () => host.replaceChildren();
              }
              const previewRuntime = mountPreviewWidget(host, current);
              if (previewRuntime === null) {
                return () => host.replaceChildren();
              }
              portalHost = host;
              owner = previewRuntime;
              updateViewport();
              void previewRuntime.refresh();
              return async () => {
                const mounted = previewRuntimes.get(node.id);
                if (mounted === previewRuntime) {
                  previewRuntimes.delete(node.id);
                }
                actionHandlers.delete(node.id);
                clearDropdownItemPresentation(context.widgets, node.id);
                closePreviewPublicationDialog(node.id);
                owner = null;
                if (portalHost === host) portalHost = null;
                await previewRuntime.destroy('canvas portal unmounted');
                if (!previewRuntimes.has(node.id)) host.replaceChildren();
              };
            }
            if (currentExtension?.type !== 'widget-instance') return undefined;
            portalHost = host;
            owner = widgetRuntime.renderOwned({
              canvasId: context.config.canvasId,
              element: current,
              root: host,
              initialViewport: fxWidgetCapsuleViewport(capsuleViewportPortal, {
                host,
                geometry,
                visible,
              }),
            });
            return async () => {
              const mounted = owner;
              owner = null;
              if (portalHost === host) portalHost = null;
              await mounted?.destroy('canvas portal unmounted');
              host.replaceChildren();
            };
          },
          onGeometryChange(next) {
            geometry = next;
            updateViewport();
          },
          onVisibilityChange(next) {
            visible = next;
            updateViewport();
          },
        });
        return {
          signature: fnCanvasWidgetMountSignature(node),
          unregister,
        };
      };

      const reconcilePortals = (): void => {
        const expected = new Map(
          context.engine.scene
            .query((candidate) => (
              candidate.kind === 'widget-frame'
              && candidate.portal !== undefined
              && fnCanvasWidgetExtension(candidate) !== null
            ))
            .map((candidate) => [
              (candidate as Readonly<TWidgetFrameNode>).portal!.portalId,
              candidate as Readonly<TWidgetFrameNode>,
            ]),
        );
        for (const [portalId, registration] of registrations) {
          if (expected.has(portalId)) continue;
          registration.unregister();
          registrations.delete(portalId);
        }
        for (const [portalId, node] of expected) {
          const signature = fnCanvasWidgetMountSignature(node);
          const existing = registrations.get(portalId);
          if (existing?.signature === signature) continue;
          existing?.unregister();
          const next = registerPortal(node);
          if (next === null) registrations.delete(portalId);
          else registrations.set(portalId, next);
        }
        const nextPreviewOwnerSnapshot = new Map<string, TPreviewWidgetPayload>();
        for (const node of expected.values()) {
          const payload = fnPreviewWidgetPayload(node);
          if (payload !== null) nextPreviewOwnerSnapshot.set(node.id, payload);
        }
        if (previewOwnerSnapshotInitialized) {
          for (const [frameNodeId, payload] of previewOwnerSnapshot) {
            const currentPayload = nextPreviewOwnerSnapshot.get(frameNodeId);
            if (currentPayload?.previewId === payload.previewId) continue;
            void closePreviewOwner(payload.previewId, frameNodeId)
              .catch((error) => args.application.logError(error));
          }
        }
        previewOwnerSnapshot = nextPreviewOwnerSnapshot;
        previewOwnerSnapshotInitialized = true;
      };

      const recoverPreviewOwnerStatuses = async (): Promise<void> => {
        const snapshot = [...previewOwnerSnapshot];
        invalidatePreviewDraftFences();
        const draftReconciliations = new Map<string, Promise<boolean>>();
        for (const [, payload] of snapshot) {
          if (draftReconciliations.has(payload.draftId)) continue;
          draftReconciliations.set(payload.draftId, (async (): Promise<boolean> => {
            const [draftError, draft] =
              await args.chatApi.api.agent.widgetDraft.get({
                draftId: payload.draftId,
              });
            if (previewEventStreamDisposed) return false;
            if (draftError || !draft) {
              args.application.logError(
                draftError
                ?? new Error('Durable widget draft status is unavailable after reconnect.'),
              );
              return false;
            }
            if (
              draft.draftId !== payload.draftId
              || draft.revision.length === 0
              || typeof draft.committedMutationId !== 'string'
              || draft.committedMutationId.length === 0
              || !Number.isSafeInteger(draft.buildSequence)
              || draft.buildSequence < 1
            ) {
              args.application.logError(
                new Error('Durable widget draft status has no exact committed mutation fence.'),
              );
              return false;
            }
            const result = reportPreviewDraftFence({
              draftId: draft.draftId,
              revision: draft.revision,
              sourceDigestSha256: draft.revision,
              committedMutationId: draft.committedMutationId,
              buildSequence: draft.buildSequence,
            });
            if (result !== 'rejected') return true;
            args.application.logError(
              new Error('Durable widget draft status returned an obsolete or cross-digest fence.'),
            );
            return false;
          })().catch((error) => {
            if (!previewEventStreamDisposed) args.application.logError(error);
            return false;
          }));
        }
        await Promise.allSettled(snapshot.map(async ([frameNodeId, payload]) => {
          const runtime = previewRuntimes.get(frameNodeId);
          if (runtime === undefined || previewEventStreamDisposed) return;
          const draftCurrent = await draftReconciliations.get(payload.draftId);
          if (!draftCurrent || previewEventStreamDisposed) return;
          const [ownerError, owner] =
            await args.chatApi.api.agent.widgetPreview.owner.get({
              previewId: payload.previewId,
              canvasId: context.config.canvasId,
              frameNodeId,
            });
          if (previewEventStreamDisposed) return;
          if (ownerError || !owner) {
            args.application.logError(
              ownerError
              ?? new Error('Durable Preview status is unavailable after reconnect.'),
            );
            return;
          }
          if (
            owner.id !== payload.previewId
            || owner.canvasId !== context.config.canvasId
            || owner.frameNodeId !== frameNodeId
            || owner.draftId !== payload.draftId
            || owner.originChatId !== payload.originChatId
            || owner.role !== payload.role
            || owner.status === 'closed'
          ) {
            args.application.logError(
              new Error('Durable Preview status no longer matches its canvas frame.'),
            );
            return;
          }
          runtime.reportOwnerState(owner);
          const durableError = owner.lastError;
          if (
            owner.status === 'building'
            && owner.pendingBuildId !== null
            && owner.buildSequence > 0
            && owner.sourceDigestSha256 !== null
            && owner.committedMutationId !== null
          ) {
            runtime.reportProgress({
              previewId: owner.id,
              revision: owner.sourceDigestSha256,
              sourceDigestSha256: owner.sourceDigestSha256,
              committedMutationId: owner.committedMutationId,
              buildId: owner.pendingBuildId,
              buildSequence: owner.buildSequence,
              phase: 'building',
            });
            return;
          }
          if (
            owner.status === 'failed'
            && owner.buildSequence > 0
            && owner.sourceDigestSha256 !== null
            && owner.committedMutationId !== null
          ) {
            const failedBuildId = (
              typeof durableError?.buildId === 'string'
              && durableError.buildId.length > 0
            )
              ? durableError.buildId
              : (
                  typeof durableError?.previewRevisionId === 'string'
                  && durableError.previewRevisionId.length > 0
                )
                  ? durableError.previewRevisionId
                  : owner.activeRevisionId ?? `failed-build-${owner.buildSequence}`;
            runtime.reportProgress({
              previewId: owner.id,
              revision: owner.sourceDigestSha256,
              sourceDigestSha256: owner.sourceDigestSha256,
              committedMutationId: owner.committedMutationId,
              buildId: failedBuildId,
              buildSequence: owner.buildSequence,
              phase: 'failed',
            });
            return;
          }
          if (owner.status === 'queued') {
            await runtime.autoRefresh();
            return;
          }
          if (owner.status === 'ready' && owner.activeRevisionId !== null) {
            const selection = runtime.publicationSelection();
            if (
              selection === null
              || selection.previewRevisionId !== owner.activeRevisionId
              || selection.buildSequence !== owner.buildSequence
              || selection.expectedBindingRevision !== owner.bindingRevision
              || selection.expectedBindingPlanDigestSha256
                !== owner.bindingPlanDigestSha256
            ) {
              await runtime.autoRefresh();
            }
          }
        }));
      };

      const handlePreviewEvent = (event: unknown): void => {
        if (
          event !== null
          && typeof event === 'object'
          && 'kind' in event
          && event.kind === 'widget-preview'
          && 'type' in event
          && event.type === 'progress'
          && 'previewId' in event
          && typeof event.previewId === 'string'
          && 'draftId' in event
          && typeof event.draftId === 'string'
          && 'revision' in event
          && typeof event.revision === 'string'
          && 'sourceDigestSha256' in event
          && typeof event.sourceDigestSha256 === 'string'
          && event.sourceDigestSha256 === event.revision
          && 'committedMutationId' in event
          && typeof event.committedMutationId === 'string'
          && event.committedMutationId.length > 0
          && 'buildId' in event
          && typeof event.buildId === 'string'
          && 'buildSequence' in event
          && typeof event.buildSequence === 'number'
          && 'phase' in event
          && (
            event.phase === 'queued'
            || event.phase === 'installing'
            || event.phase === 'building'
            || event.phase === 'validating'
            || event.phase === 'ready'
            || event.phase === 'failed'
            || event.phase === 'superseded'
          )
        ) {
          const progress = {
            previewId: event.previewId,
            revision: event.revision,
            sourceDigestSha256: event.sourceDigestSha256,
            committedMutationId: event.committedMutationId,
            buildId: event.buildId,
            buildSequence: event.buildSequence,
            phase: event.phase,
          } as const;
          for (const [frameNodeId, payload] of previewOwnerSnapshot) {
            if (
              payload.previewId !== progress.previewId
              || payload.draftId !== event.draftId
            ) continue;
            previewRuntimes.get(frameNodeId)?.reportProgress(progress);
          }
          return;
        }
        if (
          event === null
          || typeof event !== 'object'
          || !('kind' in event)
          || event.kind !== 'widget-draft'
          || !('type' in event)
          || (
            event.type !== 'created'
            && event.type !== 'changed'
            && event.type !== 'validated'
          )
          || !('draftId' in event)
          || typeof event.draftId !== 'string'
          || !('revision' in event)
          || typeof event.revision !== 'string'
          || event.revision.length === 0
          || !('sourceDigestSha256' in event)
          || typeof event.sourceDigestSha256 !== 'string'
          || event.sourceDigestSha256 !== event.revision
          || !('committedMutationId' in event)
          || typeof event.committedMutationId !== 'string'
          || event.committedMutationId.length === 0
          || !('buildSequence' in event)
          || typeof event.buildSequence !== 'number'
          || !Number.isSafeInteger(event.buildSequence)
          || event.buildSequence < 1
        ) return;
        const fenceResult = reportPreviewDraftFence({
          draftId: event.draftId,
          revision: event.revision,
          sourceDigestSha256: event.sourceDigestSha256,
          committedMutationId: event.committedMutationId,
          buildSequence: event.buildSequence,
        });
        if (
          fenceResult === 'rejected'
          || (fenceResult === 'same' && event.type !== 'changed')
        ) return;
        for (const [frameNodeId, payload] of previewOwnerSnapshot) {
          if (payload.draftId !== event.draftId) continue;
          const runtime = previewRuntimes.get(frameNodeId);
          if (runtime !== undefined) {
            void runtime.autoRefresh();
            continue;
          }
          void args.chatApi.api.agent.widgetPreview.build({
            draftId: payload.draftId,
            previewId: payload.previewId,
            canvasId: context.config.canvasId,
            frameNodeId,
          }).then(([buildError]) => {
            if (buildError) args.application.logError(buildError);
          }).catch((error) => args.application.logError(error));
        }
      };

      const waitForPreviewEventReconnect = (
        delayMs: number,
      ): Promise<void> => new Promise((resolve) => {
        if (previewEventStreamDisposed) {
          resolve();
          return;
        }
        const finish = (): void => {
          if (resolvePreviewEventReconnectDelay !== finish) return;
          resolvePreviewEventReconnectDelay = null;
          previewEventReconnectTimer = undefined;
          resolve();
        };
        resolvePreviewEventReconnectDelay = finish;
        previewEventReconnectTimer = args.widgetBrowser.setTimeout(
          finish,
          delayMs,
        );
      });

      const startPreviewEventStream = async (): Promise<void> => {
        for (
          let connectionIndex = 0;
          !previewEventStreamDisposed;
          connectionIndex += 1
        ) {
          if (connectionIndex > 0) {
            const reconnectDelay =
              PREVIEW_EVENT_RECONNECT_DELAYS_MS[connectionIndex - 1];
            if (reconnectDelay === undefined) return;
            await waitForPreviewEventReconnect(reconnectDelay);
            if (previewEventStreamDisposed) return;
          }
          let response: Awaited<
            ReturnType<TAiChatApiPort['api']['agent']['events']>
          >;
          try {
            response = await args.chatApi.api.agent.events({});
          } catch (error) {
            if (!previewEventStreamDisposed) {
              invalidatePreviewDraftFences();
              args.application.logError(error);
            }
            continue;
          }
          const [eventError, events] = response;
          if (previewEventStreamDisposed) {
            if (!eventError && events) {
              try {
                await events[Symbol.asyncIterator]().return?.();
              } catch {}
            }
            return;
          }
          if (eventError || !events) {
            invalidatePreviewDraftFences();
            args.application.logError(
              eventError ?? new Error('Widget Preview event stream is unavailable.'),
            );
            continue;
          }
          if (connectionIndex > 0) await recoverPreviewOwnerStatuses();
          const iterator = events[Symbol.asyncIterator]();
          let closed = false;
          const closeStream = (): void => {
            if (closed) return;
            closed = true;
            try {
              const closing = iterator.return?.();
              if (closing) void Promise.resolve(closing).catch(() => undefined);
            } catch {}
          };
          closePreviewEventStream = closeStream;
          try {
            while (!previewEventStreamDisposed && !closed) {
              const next = await iterator.next();
              if (next.done || previewEventStreamDisposed || closed) break;
              handlePreviewEvent(next.value);
            }
          } catch (error) {
            if (!previewEventStreamDisposed && !closed) {
              args.application.logError(error);
            }
          } finally {
            closeStream();
            if (closePreviewEventStream === closeStream) {
              closePreviewEventStream = null;
            }
            if (!previewEventStreamDisposed) invalidatePreviewDraftFences();
          }
        }
      };

      const addPublishedWidget = (
        reference: TWidgetPlacementRef,
        bounds: TWidgetFrameBounds,
        label: string,
        position: Readonly<{ x: number; y: number }>,
      ): void => {
        const validated = fnValidateDirectPublishedWidgetPlacement({
          reference,
          bounds,
        });
        if (validated.kind !== 'valid') {
          throw new Error(
            validated.kind === 'invalid'
              ? validated.message
              : 'Publish the widget before placing it on this canvas.',
          );
        }
        const id = args.widgetBrowser.createId();
        appendWidgetNode(fnCreatePublishedWidgetNode({
          id,
          parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
          orderKey: '',
          position,
          size: bounds,
          title: label,
          instanceId: args.widgetBrowser.createId(),
          definitionId: validated.descriptor.definitionId,
          revisionId: validated.descriptor.revisionId,
        }), 'vibecanvas:widget-placement');
        context.config.notification?.showSuccess(`${label} added to canvas`);
      };

      const addPreviewWidget = async (
        reference: Extract<TWidgetPlacementRef, Readonly<{ source: 'draft' }>>,
        bounds: TWidgetFrameBounds,
        position: Readonly<{ x: number; y: number }>,
      ): Promise<void> => {
        const draft = await resolveDurableDraft({ name: reference.name });
        const [resolveError, resolved] =
          await args.chatApi.api.agent.widgets.resolvePlacement({
            reference,
            expectedDraftId: draft.draftId,
          });
        if (resolveError || !resolved) {
          throw new Error(errorMessage(
            resolveError,
            'Could not resolve Preview placement.',
          ));
        }
        if (!resolved.ok) throw new Error(resolved.message);
        const validated = fnValidateWidgetPlacementDescriptor({
          descriptor: resolved.descriptor,
          expectedReference: reference,
        });
        if (!validated.ok) throw new Error(validated.message);
        if (
          validated.descriptor.kind !== 'preview'
          || validated.descriptor.draftId !== draft.draftId
        ) {
          throw new Error('The placement resolver returned a different Preview owner.');
        }
        if (
          validated.descriptor.bounds.width !== bounds.width
          || validated.descriptor.bounds.height !== bounds.height
        ) {
          throw new Error('The widget frame changed before Preview placement.');
        }
        const requestedFrameId = args.widgetBrowser.createId();
        const requestedPreviewId = args.widgetBrowser.createId();
        const owner = await ensurePreviewOwner({
          previewId: requestedPreviewId,
          frameNodeId: requestedFrameId,
          draftId: draft.draftId,
          originChatId: draft.chatId,
          role: 'placed',
        });
        if (
          owner.id !== requestedPreviewId
          || owner.frameNodeId !== requestedFrameId
        ) {
          throw new Error('Placed Preview ownership changed before placement.');
        }
        appendWidgetNode(fnCreatePreviewWidgetNode({
          id: owner.frameNodeId,
          parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
          orderKey: '',
          position,
          size: validated.descriptor.bounds,
          title: `${draft.displayName} Preview`,
          previewId: owner.id,
          draftId: draft.draftId,
          originChatId: draft.chatId,
          role: 'placed',
        }), 'vibecanvas:preview-placement');
        context.config.notification?.showSuccess(
          `${draft.displayName} Preview added to canvas`,
        );
      };

      const placement = txCreateWidgetPointerPlacement({
        camera: context.engine.camera,
        container: context.config.container,
        document: args.widgetBrowser.document,
        transients: context.engine.transients,
        async commit(placementArgs) {
          if (placementArgs.reference.source === 'draft') {
            await addPreviewWidget(
              placementArgs.reference,
              placementArgs.bounds,
              placementArgs.position,
            );
            return;
          }
          addPublishedWidget(
            placementArgs.reference,
            placementArgs.bounds,
            placementArgs.label,
            placementArgs.position,
          );
        },
        onError(error) {
          context.config.notification?.showError(
            'Widget placement failed',
            error instanceof Error ? error.message : String(error),
          );
        },
      }, {
        dragThreshold: 6,
        ownerId: `vibecanvas:widget-placement:${context.config.canvasId}`,
      });
      const unregisterPlacement = placementCoordinator.register(placement);
      const unsubscribeScene = context.engine.scene.subscribe(reconcilePortals);
      const unsubscribeCamera = context.engine.camera.subscribe(() => {
        context.engine.portals.syncNow();
      });
      const unsubscribeActivation = context.widgets.subscribeActivation(
        (activation) => {
          if (activation.type === 'header-button') {
            actionHandlers.get(activation.widgetId)?.get(activation.itemId)?.();
            return;
          }
          if (
            activation.type === 'dropdown-item'
            && activation.itemId === 'manage'
          ) {
            actionHandlers
              .get(activation.widgetId)
              ?.get(activation.dropdownItemId)
              ?.();
            return;
          }
          if (
            activation.type === 'traffic-light'
            && activation.control === 'close'
          ) {
            context.editor.commitSceneMutation({
              source: 'vibecanvas:widget-close',
              commands: [{
                type: 'remove',
                nodeId: activation.widgetId,
                descendants: 'remove',
              }],
            });
          }
        },
      );
      reconcilePortals();
      await reconcileDurablePreviewOwners();
      void startPreviewEventStream();

      return {
        async dispose() {
          const mountedPreviews = [...previewRuntimes.values()];
          previewEventStreamDisposed = true;
          closePreviewEventStream?.();
          closePreviewEventStream = null;
          if (previewEventReconnectTimer !== undefined) {
            args.widgetBrowser.clearTimeout(previewEventReconnectTimer);
          }
          resolvePreviewEventReconnectDelay?.();
          unregisterPlacement();
          placement.destroy();
          unsubscribeActivation();
          unsubscribeCamera();
          unsubscribeScene();
          for (const registration of registrations.values()) {
            registration.unregister();
          }
          registrations.clear();
          actionHandlers.clear();
          for (const close of previewPublicationDialogs.values()) close();
          previewPublicationDialogs.clear();
          for (const frameNodeId of previewRuntimes.keys()) {
            clearDropdownItemPresentation(context.widgets, frameNodeId);
          }
          await Promise.allSettled(
            mountedPreviews.map((runtime) => (
              runtime.destroy('canvas extension disposed')
            )),
          );
          previewRuntimes.clear();
          await widgetRuntime.destroy();
        },
      };
    },
  };
}

export type {
  TAiChatApiPort,
  TAiChatApplicationPort,
  TAiChatBrowserPort,
  TWidgetBrowserPort,
  TWidgetTransportPort,
} from '../ports';
export { createWidgetPlacementCoordinator } from '../widget-placement/WidgetPlacementCoordinator';
export type { TWidgetPlacementCoordinator } from '../widget-placement/WidgetPlacementCoordinator';
