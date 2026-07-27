import { oc } from "@orpc/contract";
import { ZToolGroup, ZToolGroupNameInput, ZToolGroupUpdateInput } from "./CONSTANTS";

const toolContract = oc.router({
  groups: oc.router({
    list: oc.output(ZToolGroup.array()),
    get: oc.input(ZToolGroupNameInput).output(ZToolGroup),
    create: oc.input(ZToolGroup).output(ZToolGroup),
    update: oc.input(ZToolGroupUpdateInput).output(ZToolGroup),
    remove: oc.input(ZToolGroupNameInput).output(ZToolGroup),
  }),
});

export { toolContract };
export { ZToolGroup, ZToolGroupJson } from "./CONSTANTS";
export type { TToolGroup } from "./CONSTANTS";
