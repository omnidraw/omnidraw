import { describe, expect, test } from "bun:test";
import {
  createUiOnlyMetadataFixture,
  digestBaselineValue,
  getManagedArchitectureBaselineFixture,
  parseManagedArchitectureBaselineFixture,
} from "./managed-architecture-baseline-fixture";

describe("managed architecture M0 baseline fixture", () => {
  test("keeps the protected scenario sizes and bounded live samples explicit", () => {
    const fixture = getManagedArchitectureBaselineFixture();

    expect(fixture.uiOnlyMetadata.count).toBe(10_000);
    expect(fixture.actors.modeledIdleCount).toBeGreaterThan(fixture.actors.liveIdleSampleCount);
    expect(fixture.actors.liveHotSampleCount).toBeGreaterThan(0);
    expect(fixture.resources.modeledIdleCount).toBeGreaterThan(fixture.resources.provisionedSampleCount);
    expect(fixture.resources.liveHotSampleCount).toBeLessThanOrEqual(fixture.resources.provisionedSampleCount);
    expect(fixture.resources.maxOpenHandles).toBeLessThan(fixture.resources.liveHotSampleCount);
    expect(fixture.automerge.reconnectPeerCount * fixture.automerge.reconnectCycles).toBe(256);
  });

  test("generates a deterministic 10,000-element UI-only state with no actor identity", () => {
    const fixture = getManagedArchitectureBaselineFixture();
    const first = createUiOnlyMetadataFixture(fixture);
    const second = createUiOnlyMetadataFixture(fixture);

    expect(first).toHaveLength(10_000);
    expect(new Set(first.map((record) => record.element.id)).size).toBe(10_000);
    expect(new Set(first.map((record) => record.canvasId)).size).toBe(fixture.uiOnlyMetadata.canvasCount);
    expect(new Set(first.map((record) => record.definitionId)).size).toBe(fixture.uiOnlyMetadata.definitionCount);
    expect(first.every((record) => record.element.data.type === "ui-widget")).toBe(true);
    expect(first.some((record) => "actorInstanceId" in record.element.data)).toBe(false);
    expect(first.some((record) => "actorDefinitionName" in record.element.data)).toBe(false);
    expect(first[0]).toMatchObject({
      canvasId: "baseline-canvas-000",
      definitionId: "baseline-ui-definition-00",
      element: { id: "baseline-ui-element-00000", x: 0, y: 0, zIndex: "00000" },
    });
    expect(first.at(-1)).toMatchObject({
      canvasId: "baseline-canvas-099",
      definitionId: "baseline-ui-definition-24",
      element: { id: "baseline-ui-element-09999", x: 2376, y: 2376, zIndex: "09999" },
    });
    expect(digestBaselineValue(first)).toBe(digestBaselineValue(second));
    expect(digestBaselineValue(first)).toBe("4d864fc1ef407b89f6b65671d689de8dac315bd67d4c583064a33b2183af6d87");
  });

  test("rejects fixture drift that would shrink the protected UI-only scenario", () => {
    const fixture = getManagedArchitectureBaselineFixture();
    expect(() => parseManagedArchitectureBaselineFixture({
      ...fixture,
      uiOnlyMetadata: { ...fixture.uiOnlyMetadata, count: 9_999 },
    })).toThrow("protected 10,000 element scenario");
  });
});
