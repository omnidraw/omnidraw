# Short server functions

Add server code only for protected resources or work that cannot safely run in the browser. Put direct named exports in `server/main.server.ts`, set that exact file as `server.entry`, and use `defineServerFunction` with a structural runtime schema. The entry is the function module itself; never re-export functions through an index.

```ts
import { defineServerFunction } from "@omnidraw/sdk/server";

const finiteValue = Object.freeze({
  parse(value: unknown): { value: number } {
    if (value === null || typeof value !== "object"
      || typeof (value as { value?: unknown }).value !== "number"
      || !Number.isFinite((value as { value: number }).value)) {
      throw new TypeError("Expected one finite numeric value.");
    }
    return { value: (value as { value: number }).value };
  },
  toJSONSchema: () => ({
    type: "object",
    properties: { value: { type: "number" } },
    required: ["value"],
    additionalProperties: false,
  }),
});

export const calculate = defineServerFunction({
  effect: "fn",
  input: finiteValue,
  output: finiteValue,
}, async (_context, input) => ({ value: input.value * 2 }));
```

- `fn` is deterministic and has no resources.
- `fx` may read only declared resource slots.
- `tx` may perform declared writes and should use an idempotency key for retry-safe user actions.
- Keep calls short, bounded, schema-validated, and JSON-only.
- Declare exact resource effects in both the manifest ceiling and function registration.
- Use `context.resources.read` or `context.resources.write`; never open a database, file, socket, or secret directly.
- Draft Preview may invoke exact process-owned server output only through the
  accepted manifest's exact ready resource references. Treat permitted Preview
  writes as real; do not substitute mock data or a browser-only fallback.
- Never add HTTP handlers, listeners, subprocesses, timers, sleeps, polling loops, background jobs, or mutable module-global state.
