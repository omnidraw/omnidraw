import { ORPCError } from "@orpc/server";
import { fnToToolGroup } from "./fn.to-tool-group";
import { baseToolOs } from "./orpc";

const apiUpdateToolGroup = baseToolOs.groups.update.handler(async ({ context, input }) => {
  const group = await context.db.toolGroup.update({
    currentName: input.currentName,
    ...input.group,
  });
  if (!group) {
    throw new ORPCError("NOT_FOUND", { message: `Tool group "${input.currentName}" not found` });
  }

  return fnToToolGroup({ group });
});

export { apiUpdateToolGroup };
