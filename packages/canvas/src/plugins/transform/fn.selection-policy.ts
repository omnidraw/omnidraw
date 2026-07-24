import type { TElementTransformPolicy } from "../../services/element/types";

type TArgs = {
  policies: readonly TElementTransformPolicy[];
  includeSizeConstraints: boolean;
  forceAspectRatio?: boolean;
};

const DEFAULT_HANDLES = [
  "move",
  "rotate",
  "resize-n",
  "resize-ne",
  "resize-e",
  "resize-se",
  "resize-s",
  "resize-sw",
  "resize-w",
  "resize-nw",
] as const;

export function fnMergeProductSelectionTransformPolicy(
  args: TArgs,
): TElementTransformPolicy {
  if (args.policies.length === 0) {
    return {
      handles: DEFAULT_HANDLES,
      keepAspectRatio: args.forceAspectRatio ?? false,
      allowFlip: false,
      allowRotate: true,
    };
  }
  const handles = DEFAULT_HANDLES.filter((handle) => {
    return args.policies.every((policy) => {
      return (policy.handles ?? DEFAULT_HANDLES).includes(handle);
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

  return {
    handles,
    keepAspectRatio: args.forceAspectRatio === true
      || args.policies.some((policy) => {
        return policy.keepAspectRatio === true;
      }),
    allowFlip: args.policies.every((policy) => {
      return policy.allowFlip === true;
    }),
    allowRotate: args.policies.every((policy) => {
      return policy.allowRotate !== false;
    }),
    ...(singlePolicy?.minSize === undefined
      ? {}
      : { minSize: singlePolicy.minSize }),
    ...(singlePolicy?.maxSize === undefined
      ? {}
      : { maxSize: singlePolicy.maxSize }),
    ...(sharedSnap === undefined
      ? {}
      : { snapRotationDegrees: sharedSnap }),
  };
}
