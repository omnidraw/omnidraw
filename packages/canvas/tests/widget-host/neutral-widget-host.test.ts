import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { describe, expect, test } from "vitest";
import { fnCreateClonedWidgetElement } from "../../src/widget-host/fn.create-cloned-widget-element";
import { fnCreateWidgetElement } from "../../src/widget-host/fn.create-widget-element";
import { fnNormalizeWidgetHostData } from "../../src/widget-host/fn.normalize-widget-host-data";

function createNeutralElement(): TElement {
  return fnCreateWidgetElement({
    dataType: "widget-instance",
    id: "element-1",
    definitionId: "definition-1",
    revisionId: "revision-7",
    instanceId: "instance-1",
    stateDocumentId: "state-document-1",
    x: 12,
    y: 24,
    width: 480,
    height: 320,
    now: 100,
  });
}

describe("neutral widget host", () => {
  test("normalizes browser-only and revision-pinned metadata", () => {
    const browserOnly = fnNormalizeWidgetHostData({
      type: "ui-widget",
      kind: "filesystem",
      payload: { path: "/documents" },
      w: 400,
      h: 240,
      expanded: false,
    });
    const revision = fnNormalizeWidgetHostData(createNeutralElement().data);

    expect(browserOnly).toMatchObject({
      source: "browser-only",
      hostKey: "filesystem",
      expanded: false,
    });
    expect(revision).toEqual({
      source: "revision",
      hostKey: "definition-1",
      definitionId: "definition-1",
      revisionId: "revision-7",
      instanceId: "instance-1",
      stateDocumentId: "state-document-1",
      w: 480,
      h: 320,
      expanded: true,
    });
  });

  test("clones with fresh element and instance identity while preserving the pinned revision", () => {
    const ids = ["element-clone", "instance-clone"];
    const source = createNeutralElement();
    const clone = fnCreateClonedWidgetElement({
      clone: (value) => JSON.parse(JSON.stringify(value)),
      createId: () => ids.shift() ?? "unexpected-id",
      now: () => 200,
    }, { sourceElement: source });

    expect(clone.id).toBe("element-clone");
    expect(clone.data).toEqual({
      type: "widget-instance",
      definitionId: "definition-1",
      revisionId: "revision-7",
      instanceId: "instance-clone",
      w: 480,
      h: 320,
      expanded: true,
    });
    expect(clone.parentGroupId).toBeNull();
    expect(clone.createdAt).toBe(200);
    expect(clone.updatedAt).toBe(200);
    expect(source.data).toMatchObject({
      instanceId: "instance-1",
      stateDocumentId: "state-document-1",
    });
  });
});
