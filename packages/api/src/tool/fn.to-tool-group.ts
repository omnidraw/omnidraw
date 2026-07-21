import type { TToolGroup as TDbToolGroup } from "@vibecanvas/service-db/model";
import { ZToolGroup, type TToolGroup } from "./CONSTANTS";

type TArgs = {
  group: TDbToolGroup;
};

export function fnToToolGroup(args: TArgs): TToolGroup {
  return ZToolGroup.parse(args.group);
}
