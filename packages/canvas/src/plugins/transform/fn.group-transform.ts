import type {
  TCanvasDoc,
  TElement,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type {
  TCanvasProductTransform,
  TCanvasProductTransformProposal,
} from "../../engine/product-runtime/typed";
import type { TCanvasTarget } from "../../semantic/typed";

type TAffine = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

type TPoint = {
  x: number;
  y: number;
};

type TArgsPersistElement = {
  element: TElement;
  proposal: TCanvasProductTransformProposal;
  updatedAt: number;
};

type TArgsRootProposals = {
  document: TCanvasDoc;
  proposals: readonly TCanvasProductTransformProposal[];
};

type TArgsRootTargets = {
  document: TCanvasDoc;
  targets: readonly TCanvasTarget[];
};

function affine(transform: TCanvasProductTransform): TAffine {
  const cosine = Math.cos(transform.rotationRadians);
  const sine = Math.sin(transform.rotationRadians);
  const skewX = Math.tan(transform.skew.x);
  const skewY = Math.tan(transform.skew.y);
  const scaledA = transform.scale.x;
  const scaledB = skewY * transform.scale.x;
  const scaledC = skewX * transform.scale.y;
  const scaledD = transform.scale.y;
  const a = cosine * scaledA - sine * scaledB;
  const b = sine * scaledA + cosine * scaledB;
  const c = cosine * scaledC - sine * scaledD;
  const d = sine * scaledC + cosine * scaledD;
  return {
    a,
    b,
    c,
    d,
    e: transform.position.x
      + transform.origin.x
      - a * transform.origin.x
      - c * transform.origin.y,
    f: transform.position.y
      + transform.origin.y
      - b * transform.origin.x
      - d * transform.origin.y,
  };
}

function inverse(value: TAffine): TAffine | null {
  const determinant = value.a * value.d - value.b * value.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    return null;
  }
  const a = value.d / determinant;
  const b = -value.b / determinant;
  const c = -value.c / determinant;
  const d = value.a / determinant;
  return {
    a,
    b,
    c,
    d,
    e: -(a * value.e + c * value.f),
    f: -(b * value.e + d * value.f),
  };
}

function apply(value: TAffine, point: TPoint): TPoint {
  return {
    x: value.a * point.x + value.c * point.y + value.e,
    y: value.b * point.x + value.d * point.y + value.f,
  };
}

function scaleRatio(next: number, previous: number): number {
  return previous === 0 ? 1 : next / previous;
}

function hasSelectedGroupAncestor(args: {
  document: TCanvasDoc;
  parentGroupId: string | null;
  selectedGroupIds: ReadonlySet<string>;
}): boolean {
  const visited = new Set<string>();
  let groupId = args.parentGroupId;
  while (groupId !== null && !visited.has(groupId)) {
    if (args.selectedGroupIds.has(groupId)) {
      return true;
    }
    visited.add(groupId);
    groupId = args.document.groups[groupId]?.parentGroupId ?? null;
  }
  return false;
}

export function fnPersistElementThroughGroupTransform(
  args: TArgsPersistElement,
): TElement | null {
  const previous = inverse(affine(args.proposal.previousTransform));
  if (previous === null) {
    return null;
  }
  const localPosition = apply(previous, {
    x: args.element.x,
    y: args.element.y,
  });
  const nextPosition = apply(
    affine(args.proposal.nextTransform),
    localPosition,
  );
  const relativeScaleX = scaleRatio(
    args.proposal.nextTransform.scale.x,
    args.proposal.previousTransform.scale.x,
  );
  const relativeScaleY = scaleRatio(
    args.proposal.nextTransform.scale.y,
    args.proposal.previousTransform.scale.y,
  );
  const next = {
    ...args.element,
    x: nextPosition.x,
    y: nextPosition.y,
    rotation: args.element.rotation
      + (
        args.proposal.nextTransform.rotationRadians
        - args.proposal.previousTransform.rotationRadians
      ) * 180 / Math.PI,
    ...(args.element.scaleX === undefined && relativeScaleX === 1
      ? {}
      : { scaleX: (args.element.scaleX ?? 1) * relativeScaleX }),
    ...(args.element.scaleY === undefined && relativeScaleY === 1
      ? {}
      : { scaleY: (args.element.scaleY ?? 1) * relativeScaleY }),
    updatedAt: args.updatedAt,
  } satisfies TElement;
  return [
    next.x,
    next.y,
    next.rotation,
    next.scaleX ?? 1,
    next.scaleY ?? 1,
  ].every(Number.isFinite)
    ? next
    : null;
}

export function fnRootProductTransformProposals(
  args: TArgsRootProposals,
): TCanvasProductTransformProposal[] {
  const rootKeys = new Set(fnRootProductTransformTargets({
    document: args.document,
    targets: args.proposals.map((proposal) => proposal.target),
  }).map((target) => `${target.kind}:${target.id}`));
  return args.proposals.filter((proposal) => {
    return rootKeys.has(`${proposal.target.kind}:${proposal.target.id}`);
  });
}

export function fnRootProductTransformTargets(
  args: TArgsRootTargets,
): TCanvasTarget[] {
  const selectedGroupIds = new Set(args.targets.flatMap((target) => {
    return target.kind === "group" ? [target.id] : [];
  }));
  const seen = new Set<string>();
  return args.targets.filter((target) => {
    const key = `${target.kind}:${target.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    const entity = target.kind === "group"
      ? args.document.groups[target.id]
      : args.document.elements[target.id];
    return entity !== undefined && !hasSelectedGroupAncestor({
      document: args.document,
      parentGroupId: entity.parentGroupId,
      selectedGroupIds,
    });
  }).map((target) => ({ ...target }));
}
