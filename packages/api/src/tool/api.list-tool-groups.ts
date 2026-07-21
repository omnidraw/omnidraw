import { fnToToolGroup } from "./fn.to-tool-group";
import { baseToolOs } from "./orpc";

const apiListToolGroups = baseToolOs.groups.list.handler(async ({ context }) => {
  const groups = await context.db.toolGroup.listAll();
  return groups.map((group) => fnToToolGroup({ group }));
});

export { apiListToolGroups };
