import type { ICanvasRuntimeExtension } from "@vibecanvas/canvas";
import { createAiPlugin } from "./Ai.plugin";
import { createWidgetPlugin } from "./Widget.plugin";
import type {
  TAiChatApiPort,
  TAiChatApplicationPort,
  TAiChatBrowserPort,
  TWidgetBrowserPort,
  TWidgetTransportPort,
} from "../ports";
import { WidgetManagerService } from "../widget/WidgetManagerService";

export type TCreateAiChatCanvasExtensionArgs = {
  chatApi: TAiChatApiPort;
  widgetTransport: TWidgetTransportPort;
  chatBrowser: TAiChatBrowserPort;
  widgetBrowser: TWidgetBrowserPort;
  application: TAiChatApplicationPort;
};

export function createAiChatCanvasExtension(args: TCreateAiChatCanvasExtensionArgs): ICanvasRuntimeExtension {
  return {
    name: "ai-chat",
    install(context) {
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
      });

      return {
        services: [{ name: "ai-chat-widget-manager", startOrder: 120, service: widgetManager }],
        plugins: [
          createAiPlugin({
            api: args.chatApi,
            application: args.application,
            browser: args.chatBrowser,
            createId: args.widgetBrowser.createId,
            nowDate: args.widgetBrowser.nowDate,
            widgetManager,
          }),
          createWidgetPlugin({
            application: args.application,
            transport: args.widgetTransport,
            widgetManager,
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
