import { defineServerFunction } from "@omnidraw/sdk/server";
import { z } from "zod";

export const run = defineServerFunction({
  effect: "fn",
  input: z.object({ value: z.number().finite() }),
  output: z.object({ value: z.number().finite() }),
}, async (_context, input) => ({ value: input.value }));
