import { implement } from "@orpc/server";
import { toolContract } from "./contract";
import type { TToolApiContext } from "./types";

const baseToolOs = implement(toolContract)
  .$context<TToolApiContext>();

export { baseToolOs };
