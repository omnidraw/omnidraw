import type { TWidgetResourceSelection } from '../tools/types';

export type TArgsMergeDraftResourceSelections = {
  current: readonly TWidgetResourceSelection[];
  mentioned: readonly TWidgetResourceSelection[];
};

export function fnMergeDraftResourceSelections(args: TArgsMergeDraftResourceSelections): TWidgetResourceSelection[] {
  const replacedKinds = new Set(args.mentioned.map((resource) => resource.kind));
  const retained = args.current.filter((resource) => !replacedKinds.has(resource.kind));
  const seen = new Set<string>();
  return [...retained, ...args.mentioned].filter((resource) => {
    if (seen.has(resource.id)) return false;
    seen.add(resource.id);
    return true;
  });
}
