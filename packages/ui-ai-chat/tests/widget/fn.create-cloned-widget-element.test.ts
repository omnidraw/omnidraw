import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types"
import { describe, expect, test, vi } from "vitest"
import { fnCreateClonedWidgetElement } from "../../src/widget/fn.create-cloned-widget-element"

function createAiChatElement(): TElement {
  return {
    id: "source-widget",
    x: 10,
    y: 20,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    zIndex: "a0",
    parentGroupId: "group-1",
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    style: {},
    data: {
      type: "ui-widget",
      kind: "ai-chat",
      w: 420,
      h: 640,
      expanded: true,
      window: "contained",
      payload: {
        sessionId: "source-session",
        model: { provider: 'openai', modelId: 'gpt-test' },
        thinkingLevel: 'high',
      },
    },
  }
}

describe("fnCreateClonedWidgetElement", () => {
  test("gives a cloned AI Chat a fresh generated session payload", () => {
    const cloneUiWidgetPayload = vi.fn((sourcePayload: Record<string, any>) => ({ ...sourcePayload, sessionId: "fresh-session" }))
    const cloned = fnCreateClonedWidgetElement({
      clone: (value) => structuredClone(value),
      createId: () => "cloned-widget",
      cloneUiWidgetPayload,
      now: () => 42,
    }, { sourceElement: createAiChatElement() })

    expect(cloneUiWidgetPayload).toHaveBeenCalledTimes(1)
    expect(cloned).toMatchObject({
      id: "cloned-widget",
      createdAt: 42,
      updatedAt: 42,
      parentGroupId: null,
      zIndex: "",
      data: {
        type: "ui-widget",
        payload: {
          sessionId: "fresh-session",
          model: { provider: 'openai', modelId: 'gpt-test' },
          thinkingLevel: 'high',
        },
      },
    })
    expect(cloned.data.type === "ui-widget" && cloned.data.payload?.sessionId).not.toBe('source-session')
  })
})
