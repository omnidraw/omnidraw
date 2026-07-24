import type {
  TCanvasDoc,
  TGroup,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type {
  TCanvasSemanticHit,
  TCanvasSemanticHitPart,
  TCanvasTarget,
} from "../../semantic/typed";
import type { TCanvasProjectionIndex } from "../typed";
import type {
  TCanvasResolveSemanticHitArgs,
  TCanvasResolveSemanticHitsArgs,
} from "./typed";

type TArgsResolveTarget = {
  hit: NonNullable<TCanvasResolveSemanticHitArgs["hit"]>;
  index: TCanvasProjectionIndex;
  resolveTransientTarget?: TCanvasResolveSemanticHitArgs["resolveTransientTarget"];
};

type TArgsGroupAncestry = {
  target: TCanvasTarget;
  document: TCanvasDoc;
};

type TArgsTargetLocked = TArgsGroupAncestry;

type TArgsHitPart = {
  target: TCanvasTarget;
  nodeId: string;
  enginePart?: string;
};

function resolveTarget(args: TArgsResolveTarget): TCanvasTarget | null {
  const direct = args.index.nodeTargets[args.hit.nodeId];
  if (direct !== undefined) {
    return direct;
  }
  for (let index = args.hit.path.length - 1; index >= 0; index -= 1) {
    const target = args.index.nodeTargets[args.hit.path[index]!];
    if (target !== undefined) {
      return target;
    }
  }
  if (
    args.hit.transientOwnerId === undefined
    || args.resolveTransientTarget === undefined
  ) {
    return null;
  }
  return args.resolveTransientTarget({
    ownerId: args.hit.transientOwnerId,
    nodeId: args.hit.nodeId,
    handleId: args.hit.part ?? args.hit.nodeId,
    path: args.hit.path,
  });
}

function parentGroupId(
  target: TCanvasTarget,
  canvasDocument: TCanvasDoc,
): string | null {
  if (target.kind === "element") {
    return canvasDocument.elements[target.id]?.parentGroupId ?? null;
  }
  return canvasDocument.groups[target.id]?.parentGroupId ?? null;
}

function groupChain(
  firstGroupId: string | null,
  groups: TCanvasDoc["groups"],
): readonly TGroup[] {
  const nearestFirst: TGroup[] = [];
  const visited = new Set<string>();
  let groupId = firstGroupId;
  while (groupId !== null && !visited.has(groupId)) {
    visited.add(groupId);
    const group = groups[groupId];
    if (group === undefined) {
      break;
    }
    nearestFirst.push(group);
    groupId = group.parentGroupId;
  }
  return nearestFirst;
}

function groupAncestry(args: TArgsGroupAncestry): readonly string[] {
  return groupChain(
    parentGroupId(args.target, args.document),
    args.document.groups,
  ).map((group) => group.id).reverse();
}

function targetLocked(args: TArgsTargetLocked): boolean {
  if (args.target.kind === "element") {
    const element = args.document.elements[args.target.id];
    if (element === undefined || element.locked) {
      return true;
    }
  } else {
    const group = args.document.groups[args.target.id];
    if (group === undefined || group.locked) {
      return true;
    }
  }
  return groupChain(
    parentGroupId(args.target, args.document),
    args.document.groups,
  ).some((group) => group.locked);
}

function mappedPart(value: string): TCanvasSemanticHitPart {
  if (
    value === "body"
    || value === "frame"
    || value === "inline-text"
    || value === "connector-start"
    || value === "connector-end"
    || value === "connector-segment"
    || value === "resize-handle"
    || value === "rotate-handle"
    || value === "widget-minimize"
    || value === "widget-restore"
    || value === "widget-fullscreen"
    || value === "widget-content"
  ) {
    return value;
  }
  if (
    value === "start"
    || value === "start-marker"
    || value === "endpoint:start"
  ) {
    return "connector-start";
  }
  if (
    value === "end"
    || value === "end-marker"
    || value === "endpoint:end"
  ) {
    return "connector-end";
  }
  if (value === "segment" || value.startsWith("segment:")) {
    return "connector-segment";
  }
  if (value === "rotate" || value === "handle:rotate") {
    return "rotate-handle";
  }
  if (
    value.startsWith("resize:")
    || value.startsWith("resize-")
    || value.startsWith("handle:resize-")
  ) {
    return "resize-handle";
  }
  if (value === "content" || value === "widget-content") {
    return "widget-content";
  }
  if (value === "control:minimize") {
    return "widget-minimize";
  }
  if (value === "control:restore") {
    return "widget-restore";
  }
  if (value === "control:fullscreen") {
    return "widget-fullscreen";
  }
  return {
    kind: "custom",
    value,
  };
}

function hitPart(args: TArgsHitPart): TCanvasSemanticHitPart {
  if (args.enginePart !== undefined && args.enginePart.length > 0) {
    return mappedPart(args.enginePart);
  }
  if (args.nodeId.endsWith(":inline-text")) {
    return "inline-text";
  }
  if (
    args.nodeId.endsWith(":placeholder-frame")
    || args.target.kind === "group"
  ) {
    return "frame";
  }
  return "body";
}

export function fnResolveCanvasSemanticHit(
  args: TCanvasResolveSemanticHitArgs,
): TCanvasSemanticHit | null {
  if (args.hit === null) {
    return null;
  }
  const target = resolveTarget({
    hit: args.hit,
    index: args.index,
    resolveTransientTarget: args.resolveTransientTarget,
  });
  if (target === null) {
    return null;
  }
  if (
    args.policy?.lockedTargets !== "include"
    && targetLocked({ target, document: args.document })
  ) {
    return null;
  }
  const semanticHit: TCanvasSemanticHit = {
    target,
    part: hitPart({
      target,
      nodeId: args.hit.nodeId,
      enginePart: args.hit.part,
    }),
    groupAncestry: groupAncestry({ target, document: args.document }),
    world: {
      x: args.hit.worldPoint.x,
      y: args.hit.worldPoint.y,
    },
    viewport: {
      x: args.viewport.x,
      y: args.viewport.y,
    },
  };
  if (args.hit.transientOwnerId !== undefined) {
    semanticHit.transient = {
      ownerId: args.hit.transientOwnerId,
      handleId: args.hit.part ?? args.hit.nodeId,
    };
  }
  return semanticHit;
}

export function fnResolveUniqueCanvasSemanticHits(
  args: TCanvasResolveSemanticHitsArgs,
): readonly TCanvasSemanticHit[] {
  const resolved: TCanvasSemanticHit[] = [];
  const seen = new Set<string>();
  for (const hit of args.hits) {
    const semanticHit = fnResolveCanvasSemanticHit({
      hit,
      viewport: args.worldToViewport(hit.worldPoint),
      index: args.index,
      document: args.document,
      policy: args.policy,
      resolveTransientTarget: args.resolveTransientTarget,
    });
    if (semanticHit === null) {
      continue;
    }
    const key = `${semanticHit.target.kind}:${semanticHit.target.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    resolved.push(semanticHit);
  }
  return resolved;
}
