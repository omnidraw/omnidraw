import { describe, expect, it } from "vitest"
import { fnGetWidgetCreateDraftReference } from "../../../src/chat/components/tabs/fn.tool-call"

const DRAFT_ID = "10000000-0000-4000-8000-000000000001"

const TRUSTED_WIDGET_CREATE_RESULT = {
  role: "toolResult",
  toolCallId: "call-create",
  toolName: "od_widget_create",
  content: [{ type: "text", text: "Created a widget draft." }],
  details: {
    draftId: DRAFT_ID,
    name: "Shared Timer",
    mountPath: "widgets/Shared Timer",
    source: "draft",
    draft: true,
    files: ["omnidraw.json", "widget/main.ts"],
  },
}

describe("widget-create tool-result extraction", () => {
  it("returns only the structured draft identity from an exact successful create result", () => {
    const reference = { draftId: DRAFT_ID, name: "Shared Timer" }
    expect(fnGetWidgetCreateDraftReference(TRUSTED_WIDGET_CREATE_RESULT)).toEqual(reference)
    expect(fnGetWidgetCreateDraftReference({ ...TRUSTED_WIDGET_CREATE_RESULT, isError: false })).toEqual(reference)
  })

  it("retains a safe exact-name fallback for historical create results", () => {
    expect(fnGetWidgetCreateDraftReference({
      ...TRUSTED_WIDGET_CREATE_RESULT,
      details: { ...TRUSTED_WIDGET_CREATE_RESULT.details, draftId: undefined },
    })).toEqual({ name: "Shared Timer" })
  })

  it.each([
    ["assistant prose", {
      role: "assistant",
      content: [{ type: "text", text: "od_widget_create created Shared Timer" }],
      details: TRUSTED_WIDGET_CREATE_RESULT.details,
      toolName: "od_widget_create",
    }],
    ["model-visible JSON only", {
      role: "toolResult",
      toolName: "od_widget_create",
      content: [{ type: "text", text: JSON.stringify(TRUSTED_WIDGET_CREATE_RESULT.details) }],
    }],
    ["lookalike tool name", { ...TRUSTED_WIDGET_CREATE_RESULT, toolName: "od_widget_create_preview" }],
    ["case-variant tool name", { ...TRUSTED_WIDGET_CREATE_RESULT, toolName: "VC_WIDGET_CREATE" }],
    ["failed create", { ...TRUSTED_WIDGET_CREATE_RESULT, isError: true }],
    ["missing details", { ...TRUSTED_WIDGET_CREATE_RESULT, details: undefined }],
    ["non-object details", { ...TRUSTED_WIDGET_CREATE_RESULT, details: "Shared Timer" }],
    ["published source", {
      ...TRUSTED_WIDGET_CREATE_RESULT,
      details: { ...TRUSTED_WIDGET_CREATE_RESULT.details, source: "published" },
    }],
    ["missing source marker", {
      ...TRUSTED_WIDGET_CREATE_RESULT,
      details: { name: "Shared Timer", draft: true },
    }],
    ["non-draft marker", {
      ...TRUSTED_WIDGET_CREATE_RESULT,
      details: { ...TRUSTED_WIDGET_CREATE_RESULT.details, draft: false },
    }],
    ["missing draft marker", {
      ...TRUSTED_WIDGET_CREATE_RESULT,
      details: { name: "Shared Timer", source: "draft" },
    }],
    ["non-UUID draft identity", {
      ...TRUSTED_WIDGET_CREATE_RESULT,
      details: { ...TRUSTED_WIDGET_CREATE_RESULT.details, draftId: "Shared Timer" },
    }],
    ["non-lowercase draft identity", {
      ...TRUSTED_WIDGET_CREATE_RESULT,
      details: { ...TRUSTED_WIDGET_CREATE_RESULT.details, draftId: "A0000000-0000-4000-8000-000000000001" },
    }],
  ])("rejects %s", (_label, message) => {
    expect(fnGetWidgetCreateDraftReference(message)).toBeUndefined()
  })

  it.each([
    "",
    "   ",
    " Shared Timer",
    "Shared  Timer",
    ".",
    "..",
    "../Shared Timer",
    "Shared\\Timer",
    "Shared\u0000Timer",
    "Shared:Timer",
    "CON",
    "x".repeat(121),
    42,
    null,
  ])("rejects unsafe draft name %j", (name) => {
    expect(fnGetWidgetCreateDraftReference({
      ...TRUSTED_WIDGET_CREATE_RESULT,
      details: { ...TRUSTED_WIDGET_CREATE_RESULT.details, name },
    })).toBeUndefined()
  })
})
