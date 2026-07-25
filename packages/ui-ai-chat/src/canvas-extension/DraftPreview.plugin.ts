import type { IPlugin } from "@vibecanvas/runtime"
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "@vibecanvas/canvas"
import { DRAFT_PREVIEW_WIDGET_KIND } from "../draft-preview/CONSTANTS"
import type { DraftPreviewFrameService } from "../draft-preview/DraftPreviewFrameService"
import type { WidgetManagerService } from "../widget/WidgetManagerService"

export function createDraftPreviewPlugin(portal: {
  previewFrames: DraftPreviewFrameService
  widgetManager: WidgetManagerService
}): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "draft-preview",
    apply(ctx) {
      ctx.hooks.init.tap(() => {
        portal.widgetManager.registerWidget({
          id: DRAFT_PREVIEW_WIDGET_KIND,
          dataType: "ui-widget",
          cloneable: false,
          titleBarActions: [
            { id: "reset", label: "Reset" },
            { id: "publish", label: "Publish" },
          ],
          getTitle: (element) => portal.previewFrames.getTitle(element),
          renderDom: ({ root, element, titleBar }) => {
            if (!titleBar) throw new Error("Draft Preview title bar actions are unavailable")
            return portal.previewFrames.mount({ root, element, titleBar })
          },
        })
      })
      ctx.hooks.destroy.tap(() => {
        portal.widgetManager.unregisterWidget(DRAFT_PREVIEW_WIDGET_KIND)
      })
    },
  }
}
