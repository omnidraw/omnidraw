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
    apply() {
      portal.widgetManager.registerWidget({
        id: DRAFT_PREVIEW_WIDGET_KIND,
        dataType: "ui-widget",
        cloneable: false,
        getTitle: (element) => portal.previewFrames.getTitle(element),
        renderDom: ({ root, element }) => portal.previewFrames.mount({ root, element }),
      })
    },
  }
}

