import { ORPCError } from "@orpc/server";
import { fnToToolGroup } from "./fn.to-tool-group";
import { baseToolOs } from "./orpc";

const apiCreateToolGroup = baseToolOs.groups.create.handler(async ({ context, input }) => {
  const existing = await context.db.toolGroup.getByName({ name: input.name });
  if (existing) {
    throw new ORPCError("ALREADY_EXISTS", { message: `Tool group "${input.name}" already exists` });
  }

  const group = await context.db.toolGroup.create(input);
  return fnToToolGroup({ group });
});

export { apiCreateToolGroup };
