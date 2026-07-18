import type { ThemeService } from "@vibecanvas/service-theme";
import type Konva from "konva";
import { fxDrawHost, fxUpdateHost } from "./fx.draw-host";
import type { IWidgetConfig } from "./interface";
import type { ToolService } from "@vibecanvas/canvas/services";

type TPortalRegisterWidgetTool = {
  toolService: ToolService;
  konva: typeof Konva;
  themeService: ThemeService;
  createId: () => string;
  now: () => number;
}

type TArgsRegisterWidgetTool = {
  widgetConfig: IWidgetConfig;
}

export function fxRegisterWidgetTool(portal: TPortalRegisterWidgetTool, args: TArgsRegisterWidgetTool) {
  if (!args.widgetConfig.tool) return

  portal.toolService.registerTool({
    id: args.widgetConfig.id,
    label: args.widgetConfig.tool.label,
    icon: args.widgetConfig.tool.icon,
    shortcuts: args.widgetConfig.tool.shortcuts,
    group: args.widgetConfig.tool.group,
    priority: args.widgetConfig.tool.priority,
    behavior: { type: 'mode', mode: 'draw-create' },
    drawCreate: {
      startDraft(localArgs) {
        return fxDrawHost({ konva: portal.konva, themeService: portal.themeService, createId: portal.createId, now: portal.now },
          { ...localArgs, widgetConfig: args.widgetConfig })
      },
      updateDraft(previewNode, localArgs) {
        if (!(previewNode instanceof portal.konva.Group)) return

        fxUpdateHost({ konva: portal.konva, group: previewNode, themeService: portal.themeService }, localArgs)
      },
    },
  })
}
