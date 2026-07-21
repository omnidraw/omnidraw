/**
 * @file Deterministic M0 fixture shared by the baseline harness and its contract test.
 */

import { createHash } from "node:crypto";
import type { TElement } from "../packages/service-automerge/src/types/canvas-doc.types";
import fixtureJson from "./fixtures/managed-architecture-baseline.v1.json";

export type TManagedArchitectureBaselineFixture = {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly uiOnlyMetadata: {
    readonly count: 10_000;
    readonly canvasCount: number;
    readonly definitionCount: number;
  };
  readonly actors: {
    readonly modeledIdleCount: number;
    readonly liveIdleSampleCount: number;
    readonly liveHotSampleCount: number;
    readonly messagesPerHotActor: number;
  };
  readonly automerge: {
    readonly documentCount: number;
    readonly uiElementsPerDocument: number;
    readonly reconnectPeerCount: number;
    readonly reconnectCycles: number;
  };
  readonly resources: {
    readonly modeledIdleCount: number;
    readonly provisionedSampleCount: number;
    readonly liveHotSampleCount: number;
    readonly writesPerHotResource: number;
    readonly maxOpenHandles: number;
  };
  readonly server: {
    readonly startupTimeoutMs: number;
    readonly settleMs: number;
  };
};

export type TUiOnlyMetadataRecord = {
  readonly canvasId: string;
  readonly definitionId: string;
  readonly revisionId: string;
  readonly element: TElement;
};

function requirePositiveInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new TypeError(`${path} must be a positive integer`);
  }
}

export function parseManagedArchitectureBaselineFixture(value: unknown): TManagedArchitectureBaselineFixture {
  if (value === null || typeof value !== "object") {
    throw new TypeError("managed architecture baseline fixture must be an object");
  }

  const fixture = value as Record<string, any>;
  if (fixture.schemaVersion !== 1) throw new TypeError("schemaVersion must be 1");
  if (fixture.name !== "m0-current-actor-architecture") {
    throw new TypeError("fixture name must identify the M0 current actor architecture");
  }
  if (fixture.uiOnlyMetadata?.count !== 10_000) {
    throw new TypeError("uiOnlyMetadata.count must remain the protected 10,000 element scenario");
  }

  const positiveIntegerPaths = [
    "uiOnlyMetadata.canvasCount",
    "uiOnlyMetadata.definitionCount",
    "actors.modeledIdleCount",
    "actors.liveIdleSampleCount",
    "actors.liveHotSampleCount",
    "actors.messagesPerHotActor",
    "automerge.documentCount",
    "automerge.uiElementsPerDocument",
    "automerge.reconnectPeerCount",
    "automerge.reconnectCycles",
    "resources.modeledIdleCount",
    "resources.provisionedSampleCount",
    "resources.liveHotSampleCount",
    "resources.writesPerHotResource",
    "resources.maxOpenHandles",
    "server.startupTimeoutMs",
    "server.settleMs",
  ] as const;

  for (const path of positiveIntegerPaths) {
    const valueAtPath = path.split(".").reduce<unknown>((current, segment) => {
      if (current === null || typeof current !== "object") return undefined;
      return (current as Record<string, unknown>)[segment];
    }, fixture);
    requirePositiveInteger(valueAtPath, path);
  }

  if (fixture.actors.liveIdleSampleCount >= fixture.actors.modeledIdleCount) {
    throw new TypeError("the live idle actor sample must remain smaller than the modeled idle population");
  }
  if (fixture.resources.provisionedSampleCount >= fixture.resources.modeledIdleCount) {
    throw new TypeError("the provisioned resource sample must remain smaller than the modeled idle population");
  }
  if (fixture.resources.liveHotSampleCount > fixture.resources.provisionedSampleCount) {
    throw new TypeError("hot resource count cannot exceed the provisioned sample");
  }

  return structuredClone(fixture) as TManagedArchitectureBaselineFixture;
}

export function getManagedArchitectureBaselineFixture(): TManagedArchitectureBaselineFixture {
  return parseManagedArchitectureBaselineFixture(fixtureJson);
}

export function createUiOnlyMetadataFixture(
  fixture: Pick<TManagedArchitectureBaselineFixture, "uiOnlyMetadata">,
): TUiOnlyMetadataRecord[] {
  const { count, canvasCount, definitionCount } = fixture.uiOnlyMetadata;
  return Array.from({ length: count }, (_, index) => {
    const ordinal = String(index).padStart(5, "0");
    const canvasId = `baseline-canvas-${String(index % canvasCount).padStart(3, "0")}`;
    const definitionId = `baseline-ui-definition-${String(index % definitionCount).padStart(2, "0")}`;
    return {
      canvasId,
      definitionId,
      revisionId: `${definitionId}:revision-1`,
      element: {
        id: `baseline-ui-element-${ordinal}`,
        x: (index % 100) * 24,
        y: Math.floor(index / 100) * 24,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        zIndex: ordinal,
        parentGroupId: null,
        bindings: [],
        locked: false,
        createdAt: 1,
        updatedAt: 1,
        style: {},
        data: {
          type: "ui-widget",
          kind: "m0-browser-only-fixture",
          w: 320,
          h: 240,
          expanded: true,
          window: "contained",
          payload: {
            definitionId,
            revisionId: `${definitionId}:revision-1`,
          },
        },
      },
    };
  });
}

export function digestBaselineValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
