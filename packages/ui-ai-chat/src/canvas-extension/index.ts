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
import type { ICanvasRuntimeExtension } from '@vibecanvas/canvas';
import { CANVAS_SYNTHETIC_CONTENT_LAYER_ID } from '@vibecanvas/canvas-contract';
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
import { fnValidateDirectPublishedWidgetPlacement } from '../widget-placement/fn.validate-widget-placement-descriptor';
import { txCreateWidgetPointerPlacement } from '../widget-placement/tx.pointer-placement';
import type { TWidgetTitleBarPortal } from '../widget/interface';
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
  fnCreatePublishedWidgetNode,
  type TAiWidgetPayload,
} from './fn.canvas-widget';
import { fxWidgetCapsuleViewport } from './fx.capsule-portal-viewport';
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
): TWidgetTitleBarPortal {
  return {
    onAction(id, handler) {
      handlers.set(id, handler);
      return () => {
        if (handlers.get(id) === handler) handlers.delete(id);
      };
    },
    setActionState() {
      // Title-bar state is browser-local. Cangine owns the fixed chrome and
      // invokes registered actions without persisting ephemeral button state.
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
    install(context) {
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
        wait: (timeoutMs, signal) => new Promise((resolve, reject) => {
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
        }),
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
        const dispose = render(() => AiChat({
          apiService: args.chatApi,
          application: args.application,
          browser: args.chatBrowser,
          id: node.id,
          titleBar: createTitleBarPortal(handlers),
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
            _reference: TChatWidgetDraftReference,
          ) => {
            context.config.notification?.showInfo(
              'Preview placement',
              'Publish the widget to place it on the authoritative canvas.',
            );
          },
        }), root);
        return () => {
          actionHandlers.delete(node.id);
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
              if (currentExtension.kind !== 'ai') {
                host.textContent = `Unsupported widget kind: ${currentExtension.kind}`;
                return () => host.replaceChildren();
              }
              return mountAiWidget(host, current);
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
        const siblings = context.engine.scene.childrenOf(
          CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
        );
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
        const id = args.widgetBrowser.createId();
        commands.push({
          type: 'upsert',
          node: fnCreatePublishedWidgetNode({
            id,
            parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
            orderKey,
            position,
            size: bounds,
            title: label,
            instanceId: args.widgetBrowser.createId(),
            definitionId: validated.descriptor.definitionId,
            revisionId: validated.descriptor.revisionId,
          }),
        });
        context.editor.commitSceneMutation({
          source: 'vibecanvas:widget-placement',
          commands,
        });
        context.editor.setSelection([id], { focusedNodeId: id });
        context.config.notification?.showSuccess(`${label} added to canvas`);
      };

      const placement = txCreateWidgetPointerPlacement({
        camera: context.engine.camera,
        container: context.config.container,
        document: args.widgetBrowser.document,
        transients: context.engine.transients,
        commit(placementArgs) {
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

      return {
        async dispose() {
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
