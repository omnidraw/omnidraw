import type {
  TWidgetArtifactDigest,
  TWidgetResourceBindingInput,
} from '../types';

type TArgs = Readonly<{
  bindings: readonly TWidgetResourceBindingInput[];
  digestSha256(value: string): TWidgetArtifactDigest;
}>;

export function fnCanonicalizeWidgetPreviewBindingPlan(
  bindings: readonly TWidgetResourceBindingInput[],
): string {
  return JSON.stringify(
    [...bindings]
      .map((binding) => ({
        allowRead: binding.allowRead,
        allowWrite: binding.allowWrite,
        kind: binding.kind,
        resourceId: binding.resourceId,
        slot: binding.slot,
      }))
      .sort((left, right) => (
        left.slot.localeCompare(right.slot)
        || left.resourceId.localeCompare(right.resourceId)
        || left.kind.localeCompare(right.kind)
        || Number(left.allowRead) - Number(right.allowRead)
        || Number(left.allowWrite) - Number(right.allowWrite)
      )),
  );
}

export function fnWidgetPreviewBindingPlanDigest(args: TArgs): TWidgetArtifactDigest {
  return args.digestSha256(
    fnCanonicalizeWidgetPreviewBindingPlan(args.bindings),
  );
}
