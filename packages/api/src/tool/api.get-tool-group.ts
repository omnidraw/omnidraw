import { ORPCError } from "@orpc/server";
import { fnToToolGroup } from "./fn.to-tool-group";
import { baseToolOs } from "./orpc";

const apiGetToolGroup = baseToolOs.groups.get.handler(async ({ context, input }) => {
  const group = await context.db.toolGroup.getByName(context.tenant, { name: input.name });
  if (!group) {
    throw new ORPCError("NOT_FOUND", { message: 'Tool group not found' });
  }

  return fnToToolGroup({ group });
});

export { apiGetToolGroup };
