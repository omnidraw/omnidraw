import { describe, expect, test, vi } from "vitest"
import { createDraftPreviewPlugin } from "../../src/canvas-extension/DraftPreview.plugin"
import { DRAFT_PREVIEW_WIDGET_KIND } from "../../src/draft-preview/CONSTANTS"

describe("DraftPreview plugin", () => {
  test("registers Reset and Publish as host title-bar actions and requires its portal", () => {
    const registerWidget = vi.fn()
    const unregisterWidget = vi.fn()
    const plugin = createDraftPreviewPlugin({
      previewFrames: { getTitle: vi.fn(), mount: vi.fn() },
      widgetManager: { registerWidget, unregisterWidget },
    } as never)
    let init: () => void = () => undefined
    let destroy: () => void = () => undefined

    plugin.apply({
      hooks: {
        init: { tap: (listener: () => void) => { init = listener } },
        destroy: { tap: (listener: () => void) => { destroy = listener } },
      },
    } as never)
    expect(registerWidget).not.toHaveBeenCalled()
    init()
    const config = registerWidget.mock.calls[0]?.[0]
    expect(config).toMatchObject({
      id: DRAFT_PREVIEW_WIDGET_KIND,
      dataType: "ui-widget",
      titleBarActions: [
        { id: "reset", label: "Reset" },
        { id: "publish", label: "Publish" },
      ],
    })
    expect(() => config.renderDom({ root: document.createElement("div"), element: {} })).toThrow("Draft Preview title bar actions are unavailable")
    destroy()
    expect(unregisterWidget).toHaveBeenCalledWith(DRAFT_PREVIEW_WIDGET_KIND)
  })
})
