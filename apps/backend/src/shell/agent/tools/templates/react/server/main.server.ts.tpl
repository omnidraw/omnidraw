import { defineServerFunction } from "@omnidraw/sdk/server";

const finiteValueSchema = Object.freeze({
  parse(value: unknown): { value: number } {
    if (
      value === null
      || typeof value !== "object"
      || Array.isArray(value)
      || Object.keys(value).length !== 1
      || typeof (value as { value?: unknown }).value !== "number"
      || !Number.isFinite((value as { value: number }).value)
    ) throw new TypeError("Expected one finite numeric value.");
    return { value: (value as { value: number }).value };
  },
  toJSONSchema() {
    return {
      type: "object",
      properties: { value: { type: "number" } },
      required: ["value"],
      additionalProperties: false,
    };
  },
});

export const run = defineServerFunction({
  effect: "fn",
  input: finiteValueSchema,
  output: finiteValueSchema,
}, async (_context, input) => ({ value: input.value }));
