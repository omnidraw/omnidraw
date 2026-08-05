import {
  createEvenOrderKeys,
  orderKeyBetween,
  type TPortalGeometry,
  type TSceneNode,
  type TSerializedSceneCommand,
  type TWidgetFrameNode,
} from '@omnidraw/cangine';
import type { ICanvasRuntimeExtension } from '@omnidraw/canvas';
import { CANVAS_SYNTHETIC_CONTENT_LAYER_ID } from '@omnidraw/canvas-contract';
import { fnCreateChatId } from '@omnidraw/shared-functions/chat/fn.chat-id';
import type { TWidgetFrameBounds, TWidgetPlacementRef } from '@omnidraw/widget-contract';
import { render } from 'solid-js/web';
import { AiChat } from '../chat/components';
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
  fnValidateWidgetPlacementDescriptor,
} from '../widget-placement/fn.validate-widget-placement-descriptor';
import { txCreateWidgetPointerPlacement } from '../widget-placement/tx.pointer-placement';
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
import { createWidgetPreviewOwner, type TWidgetPreviewOwner } from './preview-owner';
import { WidgetUiRuntime } from '../widget-runtime/WidgetUiRuntime';
import {
  fnAiWidgetPayload,
  fnCanvasWidgetExtension,
  fnCanvasWidgetMountSignature,
  fnCreateAiWidgetNode,
  fnCreatePreviewWidgetNode,
  fnCreatePublishedWidgetNode,
  type TAiWidgetPayload,
} from './fn.canvas-widget';
import { fxWidgetCapsuleViewport } from './fx.capsule-portal-viewport';
import { fnReduceWidgetCatalogEvent } from './fn.widget-catalog-event';
import { txPersistAiWidgetPayload } from './tx.ai-widget-payload';

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
        && button.closest('[data-omnidraw-widget-titlebar]') !== null
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
    oneShotWidgetCreation: true,
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
      const capsuleViewportPortal = {
        readClientWidth: (host: HTMLElement) => host.clientWidth,
        readClientHeight: (host: HTMLElement) => host.clientHeight,
      };
      const widgetMount = createWidgetUiArtifactMountPort({
        coordinator: capsuleHost,
        createStreamId: args.widgetBrowser.createId,
        digestSha256: args.widgetBrowser.digestSha256,
        nowMs: args.widgetBrowser.now,
        portalContentSize: capsuleViewportPortal,
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
      const actionHandlers = new Map<string, Map<string, () => void>>();
      const registrations = new Map<string, TPortalRegistration>();
      // Freshly placed Preview frames auto-build once on first attach; a frame
      // that outlives its host session keeps the stopped fallback instead.
      const freshPreviewNodes = new Set<string>();
      let publishedCatalogEpoch = 0;
      const publishedWidgetEpochs = new Map<string, number>();
      const previewOwnersByWidgetKey = new Map<string, TWidgetPreviewOwner>();
      const previewRefreshTimers = new Map<string, unknown>();
      const portalRegistrationSignature = (
        node: Readonly<TWidgetFrameNode>,
      ): string => {
        const extension = fnCanvasWidgetExtension(node);
        return fnCanvasWidgetMountSignature(node, {
          global: publishedCatalogEpoch,
          widget: extension?.type === 'widget-instance'
            ? publishedWidgetEpochs.get(extension.widgetKey) ?? 0
            : 0,
        });
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

      const DRAFT_PREVIEW_BOUNDS = Object.freeze({ width: 360, height: 320 });

      /** Places (or focuses) the live draft Preview frame beside the chat. */
      const openDraftPreviewBeside = async (
        chatNodeId: string,
        name: string,
      ): Promise<void> => {
        try {
          const [catalogError, catalog] = await args.chatApi.api.widget.catalog.get();
          if (catalogError || !catalog) {
            throw new Error(errorMessage(catalogError, 'The widget catalog is unavailable.'));
          }
          const entry = catalog.entries.find(
            (candidate) => candidate.draft?.config?.name === name,
          );
          if (entry?.draft == null) {
            throw new Error(`Widget draft '${name}' was not found in the shared drafts root.`);
          }
          if (entry.draft.health !== 'healthy') {
            throw new Error(`Widget draft '${name}' is unhealthy and cannot be previewed.`);
          }
          const chatNode = widgetFrame(context.engine.scene.get(chatNodeId));
          await placementCoordinator.addToCanvas({
            reference: {
              source: 'draft',
              widgetKey: entry.widgetKey,
              catalogGeneration: catalog.generation,
            },
            bounds: DRAFT_PREVIEW_BOUNDS,
            label: entry.draft.config?.tool.label ?? entry.draft.config?.name ?? name,
            ...(chatNode === null ? {} : {
              position: {
                x: chatNode.transform.position.x + chatNode.size.width + 24,
                y: chatNode.transform.position.y,
              },
            }),
          });
        } catch (error) {
          context.config.notification?.showError(
            'Could not open the widget Preview',
            errorMessage(error, 'The widget Preview could not be opened.'),
          );
        }
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
          onOpenWidgetPreview: ({ name }) => openDraftPreviewBeside(node.id, name),
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
        }), root);
        return () => {
          actionHandlers.delete(node.id);
          titleBar.destroy();
          dispose();
          root.replaceChildren();
        };
      };

      const registerPortal = (
        node: Readonly<TWidgetFrameNode>,
      ): TPortalRegistration | null => {
        const extension = fnCanvasWidgetExtension(node);
        const portalId = node.portal?.portalId;
        if (extension === null || portalId === undefined) return null;
        context.trace?.emit({
          channel: 'widget-host',
          type: 'portal-reconcile',
          priority: 'normal',
          correlation: {
            canvasId: context.config.canvasId,
            nodeId: node.id,
            widgetId: node.id,
          },
          data: {
            portalId,
            widgetType: extension.type,
            widgetKind: extension.type === 'ui-widget' ? extension.kind : null,
          },
        });
        let geometry: TPortalGeometry | null = null;
        let visible = true;
        let portalHost: HTMLElement | null = null;
        let owner: TWidgetUiRuntimeRenderOwner | null = null;
        let previewOwner: TWidgetPreviewOwner | null = null;
        const updateViewport = () => {
          const viewport = fxWidgetCapsuleViewport(capsuleViewportPortal, {
            host: portalHost,
            geometry,
            visible,
          });
          owner?.setViewport(viewport);
          previewOwner?.setViewport(viewport);
        };
        const unregister = context.engine.portals.register({
          portalId,
          mount({ host }) {
            const reportUnmount = () => context.trace?.emit({
              channel: 'widget-host',
              type: 'portal-unmounted',
              priority: 'high',
              correlation: {
                canvasId: context.config.canvasId,
                nodeId: node.id,
                widgetId: node.id,
              },
              data: { portalId },
            });
            context.trace?.emit({
              channel: 'widget-host',
              type: 'portal-mounted',
              priority: 'high',
              correlation: {
                canvasId: context.config.canvasId,
                nodeId: node.id,
                widgetId: node.id,
              },
              data: { portalId },
            });
            const current = widgetFrame(context.engine.scene.get(node.id));
            if (current === null) return undefined;
            const currentExtension = fnCanvasWidgetExtension(current);
            if (currentExtension?.type === 'ui-widget') {
              if (currentExtension.kind === 'ai') {
                const unmount = mountAiWidget(host, current);
                return () => {
                  reportUnmount();
                  unmount();
                };
              }
              host.textContent = `Unsupported widget kind: ${currentExtension.kind}`;
              return () => {
                reportUnmount();
                host.replaceChildren();
              };
            }
            if (currentExtension?.type === 'widget-instance') {
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
                reportUnmount();
                const mounted = owner;
                owner = null;
                if (portalHost === host) portalHost = null;
                await mounted?.destroy('canvas portal unmounted');
                host.replaceChildren();
              };
            }
            if (currentExtension?.type === 'widget-preview') {
              portalHost = host;
              let previewDisposed = false;
              const owner = createWidgetPreviewOwner({
                transport: args.widgetTransport,
                mount: widgetMount,
                codec: {
                  decodeBase64: args.widgetBrowser.decodeBase64,
                  digestSha256: args.widgetBrowser.digestSha256,
                },
                canvasId: context.config.canvasId,
                widgetKey: currentExtension.widgetKey,
                isTargetCurrent: () => !previewDisposed,
                shouldAutoBuild: () => freshPreviewNodes.delete(node.id),
              });
              previewOwner = owner;
              const ownedKey = currentExtension.widgetKey;
              previewOwnersByWidgetKey.set(ownedKey, owner);
              owner.attach(host, current);
              updateViewport();
              return async () => {
                reportUnmount();
                if (portalHost === host) portalHost = null;
                previewDisposed = true;
                if (previewOwnersByWidgetKey.get(ownedKey) === owner) {
                  previewOwnersByWidgetKey.delete(ownedKey);
                }
                const timer = previewRefreshTimers.get(ownedKey);
                if (timer !== undefined) {
                  args.widgetBrowser.clearTimeout(timer);
                  previewRefreshTimers.delete(ownedKey);
                }
                previewOwner = null;
                await owner.destroy('canvas portal unmounted');
                host.replaceChildren();
              };
            }
            return undefined;
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
          signature: portalRegistrationSignature(node),
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
          context.trace?.emit({
            channel: 'widget-host',
            type: 'portal-unregistered',
            priority: 'high',
            correlation: { canvasId: context.config.canvasId },
            data: { portalId },
          });
          registration.unregister();
          registrations.delete(portalId);
        }
        for (const [portalId, node] of expected) {
          const signature = portalRegistrationSignature(node);
          const existing = registrations.get(portalId);
          if (existing?.signature === signature) continue;
          existing?.unregister();
          const next = registerPortal(node);
          if (next === null) registrations.delete(portalId);
          else {
            registrations.set(portalId, next);
            context.trace?.emit({
              channel: 'widget-host',
              type: 'portal-registered',
              priority: 'high',
              correlation: {
                canvasId: context.config.canvasId,
                nodeId: node.id,
                widgetId: node.id,
              },
              data: { portalId },
            });
          }
        }
      };

      let widgetCatalogEventStreamDisposed = false;
      let closeWidgetCatalogEventStream: (() => void) | null = null;
      let lastWidgetCatalogGeneration = 0;
      const schedulePreviewRefresh = (widgetKey: string): void => {
        const existing = previewRefreshTimers.get(widgetKey);
        if (existing !== undefined) args.widgetBrowser.clearTimeout(existing);
        const timer = args.widgetBrowser.setTimeout(() => {
          previewRefreshTimers.delete(widgetKey);
          const owner = previewOwnersByWidgetKey.get(widgetKey);
          if (owner !== undefined) void owner.refresh();
        }, 400);
        previewRefreshTimers.set(widgetKey, timer);
      };
      const refreshChangedPreviews = (widgetKeys: readonly string[]): void => {
        for (const widgetKey of widgetKeys) schedulePreviewRefresh(widgetKey);
      };
      const refreshAllPreviews = (): void => {
        for (const widgetKey of previewOwnersByWidgetKey.keys()) {
          schedulePreviewRefresh(widgetKey);
        }
      };
      const invalidatePublishedWidgetKeys = (
        widgetKeys: readonly string[],
      ): void => {
        for (const widgetKey of widgetKeys) {
          publishedWidgetEpochs.set(
            widgetKey,
            (publishedWidgetEpochs.get(widgetKey) ?? 0) + 1,
          );
        }
        refreshChangedPreviews(widgetKeys);
        reconcilePortals();
      };
      const startWidgetCatalogEventStream = async (): Promise<void> => {
        while (!widgetCatalogEventStreamDisposed) {
          let response: Awaited<
            ReturnType<TWidgetTransportPort['api']['widget']['catalog']['events']>
          >;
          try {
            response = await args.widgetTransport.api.widget.catalog.events({
              afterGeneration: lastWidgetCatalogGeneration,
            });
          } catch (error) {
            if (!widgetCatalogEventStreamDisposed) args.application.logError(error);
            await waitForWidgetRuntime(1_000).catch(() => undefined);
            continue;
          }
          const [eventError, events] = response;
          if (widgetCatalogEventStreamDisposed) {
            if (!eventError && events) {
              try {
                await events[Symbol.asyncIterator]().return?.();
              } catch {}
            }
            return;
          }
          if (eventError || !events) {
            args.application.logError(
              eventError ?? new Error('Widget catalog event stream is unavailable.'),
            );
            await waitForWidgetRuntime(1_000).catch(() => undefined);
            continue;
          }
          const iterator = events[Symbol.asyncIterator]();
          let closed = false;
          const close = (): void => {
            if (closed) return;
            closed = true;
            try {
              const operation = iterator.return?.();
              if (operation) void Promise.resolve(operation).catch(() => undefined);
            } catch {}
          };
          closeWidgetCatalogEventStream = close;
          try {
            while (!widgetCatalogEventStreamDisposed && !closed) {
              const next = await iterator.next();
              if (next.done || widgetCatalogEventStreamDisposed || closed) break;
              const update = fnReduceWidgetCatalogEvent(
                lastWidgetCatalogGeneration,
                next.value,
              );
              lastWidgetCatalogGeneration = update.observedGeneration;
              if (update.remount === 'all') {
                publishedCatalogEpoch += 1;
                refreshAllPreviews();
                reconcilePortals();
              } else if (update.remount === 'keys') {
                invalidatePublishedWidgetKeys(update.widgetKeys);
              }
            }
          } catch (error) {
            if (!widgetCatalogEventStreamDisposed && !closed) {
              args.application.logError(error);
            }
          } finally {
            close();
            if (closeWidgetCatalogEventStream === close) {
              closeWidgetCatalogEventStream = null;
            }
          }
          if (!widgetCatalogEventStreamDisposed) {
            await waitForWidgetRuntime(1_000).catch(() => undefined);
          }
        }
      };

      const addPublishedWidget = (
        reference: Extract<TWidgetPlacementRef, Readonly<{ source: 'published' }>>,
        bounds: TWidgetFrameBounds,
        label: string,
        position: Readonly<{ x: number; y: number }>,
      ): Promise<void> => {
        const add = async (): Promise<void> => {
          const [resolveError, resolved] =
            await args.widgetTransport.api.widget.placement.resolve({ reference });
          if (resolveError || !resolved) {
            throw new Error(errorMessage(
              resolveError,
              'Could not resolve published widget placement.',
            ));
          }
          const validated = fnValidateWidgetPlacementDescriptor({
            descriptor: resolved,
            expectedReference: reference,
          });
          if (!validated.ok || validated.descriptor.kind !== 'published') {
            throw new Error(
              validated.ok
                ? 'The placement resolver returned an unsupported widget kind.'
                : validated.message,
            );
          }
          if (
            validated.descriptor.bounds.width !== bounds.width
            || validated.descriptor.bounds.height !== bounds.height
          ) {
            throw new Error('The widget frame changed before published placement.');
          }
          const id = args.widgetBrowser.createId();
          appendWidgetNode(fnCreatePublishedWidgetNode({
            id,
            parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
            orderKey: '',
            position,
            size: validated.descriptor.bounds,
            title: label,
            instanceId: args.widgetBrowser.createId(),
            widgetKey: validated.descriptor.widgetKey,
            resourceBindings: validated.descriptor.resourceBindings,
          }), 'omnidraw:widget-placement');
          context.config.notification?.showSuccess(`${label} added to canvas`);
        };
        return add();
      };

      const placement = txCreateWidgetPointerPlacement({
        camera: context.engine.camera,
        container: context.config.container,
        document: args.widgetBrowser.document,
        transients: context.engine.transients,
        async commit(placementArgs) {
          context.trace?.emit({
            channel: 'widget-host',
            type: 'placement-commit',
            priority: 'critical',
            correlation: { canvasId: context.config.canvasId },
            data: {
              source: placementArgs.reference.source,
              position: placementArgs.position,
              bounds: placementArgs.bounds,
            },
          });
          if (placementArgs.reference.source === 'draft') {
            const widgetKey = placementArgs.reference.widgetKey;
            const existingPreview = context.engine.scene
              .query((candidate) => candidate.kind === 'widget-frame')
              .find((candidate) => {
                const extension = fnCanvasWidgetExtension(candidate);
                return extension?.type === 'widget-preview'
                  && extension.widgetKey === widgetKey;
              });
            if (existingPreview) {
              context.editor.setSelection(
                [existingPreview.id],
                { focusedNodeId: existingPreview.id },
              );
              context.config.notification?.showInfo(
                `${placementArgs.label} Preview is already on the canvas`,
              );
              return;
            }
            const previewNodeId = args.widgetBrowser.createId();
            appendWidgetNode(fnCreatePreviewWidgetNode({
              id: previewNodeId,
              parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
              orderKey: '',
              position: placementArgs.position,
              size: placementArgs.bounds,
              title: placementArgs.label,
              instanceId: args.widgetBrowser.createId(),
              widgetKey,
            }), 'omnidraw:widget-placement');
            freshPreviewNodes.add(previewNodeId);
            context.config.notification?.showSuccess(
              `${placementArgs.label} Preview added to canvas`,
            );
            return;
          }
          await addPublishedWidget(
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
        ownerId: `omnidraw:widget-placement:${context.config.canvasId}`,
      });
      const unregisterPlacement = placementCoordinator.register(placement);
      const unsubscribeScene = context.engine.scene.subscribe(reconcilePortals);
      const unsubscribeWidgetCatalog =
        args.application.subscribeCatalogInvalidation?.('widgets', () => {
          publishedCatalogEpoch += 1;
          reconcilePortals();
        });
      const unsubscribeCamera = context.engine.camera.subscribe(() => {
        context.engine.portals.syncNow();
      });
      const unsubscribeActivation = context.widgets.subscribeActivation(
        (activation) => {
          context.trace?.emit({
            channel: 'widget-host',
            type: 'host-control-activated',
            priority: 'critical',
            correlation: {
              canvasId: context.config.canvasId,
              widgetId: activation.widgetId,
            },
            data: activation,
          });
          if (activation.type === 'header-button') {
            actionHandlers.get(activation.widgetId)?.get(activation.itemId)?.();
            return;
          }
          if (
            activation.type === 'traffic-light'
            && activation.control === 'close'
          ) {
            context.editor.commitSceneMutation({
              source: 'omnidraw:widget-close',
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
      void startWidgetCatalogEventStream();

      return {
        async dispose() {
          widgetCatalogEventStreamDisposed = true;
          closeWidgetCatalogEventStream?.();
          closeWidgetCatalogEventStream = null;
          for (const timer of previewRefreshTimers.values()) {
            args.widgetBrowser.clearTimeout(timer);
          }
          previewRefreshTimers.clear();
          previewOwnersByWidgetKey.clear();
          unregisterPlacement();
          placement.destroy();
          unsubscribeActivation();
          unsubscribeCamera();
          unsubscribeScene();
          unsubscribeWidgetCatalog?.();
          for (const registration of registrations.values()) {
            registration.unregister();
          }
          registrations.clear();
          actionHandlers.clear();
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
