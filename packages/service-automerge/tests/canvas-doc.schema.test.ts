import { describe, expect, test } from "bun:test";
import {
  zCanvasDoc,
  zElementData,
  zElementId,
  zWidgetInstanceData,
} from "../src/types/canvas-doc.zod";

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const widgetInstanceData = {
  type: "widget-instance" as const,
  definitionId: uuid(1),
  revisionId: uuid(2),
  instanceId: uuid(3),
  stateDocumentId: "automerge:4P9w8qKtNvbzkexUwmBRETTKQgLf",
  uiProps: {
    title: "Capsule widget",
    filters: { active: true, tags: ["one", "two"] },
  },
  w: 480,
  h: 320,
  expanded: true,
  window: "contained" as const,
};

describe("widget-instance canvas data", () => {
  test("accepts the exact neutral persisted identity and frame shape", () => {
    expect(zWidgetInstanceData.parse(widgetInstanceData)).toEqual(widgetInstanceData);
    expect(zElementData.parse(widgetInstanceData)).toEqual(widgetInstanceData);
  });

  test("does not require a collaborative state document", () => {
    const { stateDocumentId, ...withoutStateDocument } = widgetInstanceData;
    void stateDocumentId;

    expect(zWidgetInstanceData.parse(withoutStateDocument)).toEqual(withoutStateDocument);
  });

  test("accepts bounded JSON UI props and rejects values outside the channel contract", () => {
    expect(zWidgetInstanceData.safeParse({
      ...widgetInstanceData,
      uiProps: { greeting: "hello", count: 2, nested: { enabled: true } },
    }).success).toBe(true);
    expect(zWidgetInstanceData.safeParse({
      ...widgetInstanceData,
      uiProps: { message: "x".repeat(1_025) },
    }).success).toBe(false);
    expect(zWidgetInstanceData.safeParse({
      ...widgetInstanceData,
      uiProps: Object.fromEntries(
        Array.from({ length: 65 }, (_, index) => [`key-${index}`, index]),
      ),
    }).success).toBe(false);
  });

  test("matches the Capsule props channel depth boundary", () => {
    expect(zWidgetInstanceData.safeParse({
      ...widgetInstanceData,
      uiProps: {
        level1: {
          level2: {
            level3: {
              level4: { value: "accepted" },
            },
          },
        },
      },
    }).success).toBe(true);
    expect(zWidgetInstanceData.safeParse({
      ...widgetInstanceData,
      uiProps: {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: { value: "rejected" },
              },
            },
          },
        },
      },
    }).success).toBe(false);
  });

  test("rejects strings and keys Capsule cannot normalize as structured values", () => {
    expect(zWidgetInstanceData.safeParse({
      ...widgetInstanceData,
      uiProps: { message: "\ud800" },
    }).success).toBe(false);
    expect(zWidgetInstanceData.safeParse({
      ...widgetInstanceData,
      uiProps: { ["invalid-\udfff"]: "value" },
    }).success).toBe(false);
    expect(zWidgetInstanceData.safeParse({
      ...widgetInstanceData,
      uiProps: { emoji: "well-formed \ud83d\ude80" },
    }).success).toBe(true);
  });

  test.each([
    ["process", { processId: "pid-1" }],
    ["server path", { serverPath: "/private/server.js" }],
    ["artifact path", { artifactPath: "/private/artifact.js" }],
  ])("strictly rejects %s fields", (_label, forbiddenField) => {
    expect(zWidgetInstanceData.safeParse({
      ...widgetInstanceData,
      ...forbiddenField,
    }).success).toBe(false);
  });

  test.each(["definitionId", "revisionId", "instanceId"] as const)(
    "rejects a non-canonical %s",
    (field) => {
      expect(zWidgetInstanceData.safeParse({
        ...widgetInstanceData,
        [field]: "00000000-0000-4000-8000-00000000000A",
      }).success).toBe(false);
    },
  );

  test.each([
    "state-document-9",
    "automerge:state-document-9",
    `${widgetInstanceData.stateDocumentId}#4P9w8qKtNvbzkexUwmBRETTKQgLf`,
  ])("rejects invalid or pinned state document URL %s", (stateDocumentId) => {
    expect(zWidgetInstanceData.safeParse({
      ...widgetInstanceData,
      stateDocumentId,
    }).success).toBe(false);
  });

  test("enforces the projection's bounded trimmed element id and key identity", () => {
    expect(zElementId.safeParse(" element-1").success).toBe(false);
    expect(zElementId.safeParse("x".repeat(201)).success).toBe(false);
    const element = {
      id: "element-1",
      x: 0,
      y: 0,
      rotation: 0,
      zIndex: "a0",
      parentGroupId: null,
      bindings: [],
      locked: false,
      createdAt: 1,
      updatedAt: 1,
      data: widgetInstanceData,
      style: {},
    };
    expect(zCanvasDoc.safeParse({
      id: "embedded-id-is-not-authoritative",
      name: "Projection fixture",
      elements: { "element-1": element },
      groups: {},
    }).success).toBe(true);
    expect(zCanvasDoc.safeParse({
      id: "embedded-id-is-not-authoritative",
      name: "Projection fixture",
      elements: { "different-key": element },
      groups: {},
    }).success).toBe(false);
  });
});
