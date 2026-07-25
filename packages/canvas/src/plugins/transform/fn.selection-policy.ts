import type { TElementTransformPolicy } from "../../services/element/types";
import type { TCanvasProductTransformPolicy } from "../../engine/product-runtime/typed";

type TArgs = {
  baseline: TCanvasProductTransformPolicy;
  policies: readonly TElementTransformPolicy[];
  includeSizeConstraints: boolean;
  forceLockedAspectRatio?: boolean;
};

function aspectRatioMode(
  args: TArgs,
): NonNullable<TCanvasProductTransformPolicy["aspectRatioMode"]> {
  if (args.forceLockedAspectRatio === true) {
    return "locked";
  }
  const modes = [
    args.baseline.aspectRatioMode ?? "free",
    ...args.policies.flatMap((policy) => {
      return policy.aspectRatioMode === undefined
        ? []
        : [policy.aspectRatioMode];
    }),
  ];
  if (modes.includes("locked")) {
    return "locked";
  }
  if (modes.includes("shift-invert")) {
    return "shift-invert";
  }
  if (modes.includes("shift-lock")) {
    return "shift-lock";
  }
  return "free";
}

export function fnMergeProductSelectionTransformPolicy(
  args: TArgs,
): TCanvasProductTransformPolicy {
  const handles = args.baseline.handles.filter((handle) => {
    return args.policies.every((policy) => {
      return policy.handles?.includes(handle) ?? true;
    });
  });
  const snapRotationDegrees = args.policies[0]?.snapRotationDegrees;
  const sharedSnap = snapRotationDegrees !== undefined
    && args.policies.every((policy) => {
      return policy.snapRotationDegrees === snapRotationDegrees;
    })
    ? snapRotationDegrees
    : undefined;
  const singlePolicy = args.includeSizeConstraints
    ? args.policies[0]
    : undefined;
  const baselineMin = args.baseline.minSize;
  const productMin = singlePolicy?.minSize;
  const minSize = baselineMin === undefined && productMin === undefined
    ? undefined
    : {
        width: Math.max(baselineMin?.width ?? 0, productMin?.width ?? 0),
        height: Math.max(baselineMin?.height ?? 0, productMin?.height ?? 0),
      };
  const baselineMax = args.baseline.maxSize;
  const productMax = singlePolicy?.maxSize;
  const maxSize = baselineMax === undefined && productMax === undefined
    ? undefined
    : {
        width: Math.min(
          baselineMax?.width ?? Number.POSITIVE_INFINITY,
          productMax?.width ?? Number.POSITIVE_INFINITY,
        ),
        height: Math.min(
          baselineMax?.height ?? Number.POSITIVE_INFINITY,
          productMax?.height ?? Number.POSITIVE_INFINITY,
        ),
      };

  return {
    handles,
    aspectRatioMode: aspectRatioMode(args),
    allowFlip: args.baseline.allowFlip === true
      && args.policies.every((policy) => {
      return policy.allowFlip === true;
    }),
    allowRotate: args.baseline.allowRotate !== false
      && args.policies.every((policy) => {
      return policy.allowRotate !== false;
    }),
    ...(minSize === undefined
      ? {}
      : { minSize }),
    ...(maxSize === undefined
      ? {}
      : { maxSize }),
    ...(sharedSnap === undefined
      ? {}
      : { snapRotationRadians: sharedSnap * Math.PI / 180 }),
  };
}
