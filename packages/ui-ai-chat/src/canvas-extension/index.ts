import type { ICanvasRuntimeExtension } from "@vibecanvas/canvas";
import { createAiPlugin } from "./Ai.plugin";
import { createDraftPreviewPlugin } from "./DraftPreview.plugin";
import { createWidgetPlugin } from "./Widget.plugin";
import type {
  TAiChatApiPort,
  TAiChatApplicationPort,
  TAiChatBrowserPort,
  TWidgetBrowserPort,
  TWidgetTransportPort,
} from "../ports";
import { WidgetManagerService } from "../widget/WidgetManagerService";
import { DraftPreviewFrameService } from "../draft-preview/DraftPreviewFrameService";
import { WidgetPlacementService } from "../widget-placement/WidgetPlacementService";
import { createWidgetPlacementCoordinator, type TWidgetPlacementCoordinator } from "../widget-placement/WidgetPlacementCoordinator";
import { WidgetUiRuntime } from '../widget-runtime/WidgetUiRuntime';
import { fnWidgetRuntimeLocalTargetMatchesElement } from '../widget-runtime/fn.runtime-identity';
import type { TWidgetCollaborativeStatePort } from '../widget-runtime/interface';
import { widgetUiArtifactMount } from '../widget-runtime/mount-widget-ui-artifact';

export type TCreateAiChatCanvasExtensionArgs = {
  chatApi: TAiChatApiPort;
  widgetTransport: TWidgetTransportPort;
  chatBrowser: TAiChatBrowserPort;
  widgetBrowser: TWidgetBrowserPort;
  application: TAiChatApplicationPort;
  widgetPlacement?: TWidgetPlacementCoordinator;
  widgetCollaborativeState?: TWidgetCollaborativeStatePort;
};

export function createAiChatCanvasExtension(args: TCreateAiChatCanvasExtensionArgs): ICanvasRuntimeExtension {
  return {
    name: "ai-chat",
    install(context) {
      const placementCoordinator = args.widgetPlacement ?? createWidgetPlacementCoordinator();
      const widgetRuntime = new WidgetUiRuntime({
        transport: args.widgetTransport,
        codec: {
          decodeBase64: args.widgetBrowser.decodeBase64,
          decodeUtf8: args.widgetBrowser.decodeUtf8,
          digestSha256: args.widgetBrowser.digestSha256,
        },
        mount: widgetUiArtifactMount,
        createIdempotencyKey: args.widgetBrowser.createId,
        organizationId: args.widgetBrowser.organizationId,
        tenantAuthorityKey: args.widgetBrowser.tenantAuthorityKey,
        nowMs: args.widgetBrowser.now,
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
          return fnWidgetRuntimeLocalTargetMatchesElement(
            target,
            context.services.crdt.doc()?.elements[target.elementId],
          );
        },
      });
      const widgetManager = new WidgetManagerService({
        crdtService: context.services.crdt,
        contextMenuService: context.services.contextMenu,
        historyService: context.services.history,
        loggingService: context.services.logging,
        themeService: context.services.theme,
        selectionService: context.services.selection,
        elementService: context.services.element,
        toolService: context.services.tool,
        sceneService: context.services.scene,
        renderOrderService: context.services.renderOrder,
        cameraService: context.services.camera,
        confirmDialogService: context.services.confirmDialog,
        browser: args.widgetBrowser,
        transport: args.widgetTransport,
        neutralHost: {
          canvasId: context.config.canvasId,
          runtime: widgetRuntime,
        },
      });
      const previewFrames = new DraftPreviewFrameService({
        api: args.chatApi,
        application: args.application,
        browser: args.widgetBrowser,
        crdt: context.services.crdt,
        element: context.services.element,
        history: context.services.history,
        renderOrder: context.services.renderOrder,
        scene: context.services.scene,
        selection: context.services.selection,
        tool: context.services.tool,
      });
      const widgetPlacement = new WidgetPlacementService({
        api: args.chatApi,
        browser: args.widgetBrowser,
        coordinator: placementCoordinator,
        dropPlacement: context.services.widgetPlacement,
        previewFrames,
        widgetManager,
      });

      return {
        services: [
          { name: "ai-chat-widget-manager", startOrder: 120, service: widgetManager },
          { name: "draft-preview-frame", startOrder: 121, service: previewFrames },
          { name: "widget-placement", startOrder: 122, service: widgetPlacement },
        ],
        plugins: [
          createDraftPreviewPlugin({ previewFrames, widgetManager }),
          createAiPlugin({
            api: args.chatApi,
            application: args.application,
            browser: args.chatBrowser,
            createId: args.widgetBrowser.createId,
            nowDate: args.widgetBrowser.nowDate,
            widgetManager,
            openWidgetPreview: (openArgs) => previewFrames.open(openArgs),
          }),
          createWidgetPlugin({
            application: args.application,
            transport: args.widgetTransport,
            widgetManager,
            widgetPlacement,
          }),
        ],
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
} from "../ports";
export { createWidgetPlacementCoordinator } from "../widget-placement/WidgetPlacementCoordinator";
export type { TWidgetPlacementCoordinator } from "../widget-placement/WidgetPlacementCoordinator";
