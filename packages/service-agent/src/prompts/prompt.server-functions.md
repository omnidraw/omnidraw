# Short server functions

Add server code only for protected resources or work that cannot safely run in the browser. Put direct named exports in `server/main.server.ts`, set that exact file as `server.entry`, and use `defineServerFunction` with Zod runtime schemas. The entry is the function module itself; never re-export functions through an index.

```ts
import { defineServerFunction } from "@vibecanvas/sdk/server";
import { z } from "zod";

export const calculate = defineServerFunction({
  effect: "fn",
  input: z.object({ value: z.number().finite() }),
  output: z.object({ doubled: z.number().finite() }),
}, async (_context, input) => ({ doubled: input.value * 2 }));
```

- `fn` is deterministic and has no resources.
- `fx` may read only declared resource slots.
- `tx` may perform declared writes and should use an idempotency key for retry-safe user actions.
- Keep calls short, bounded, schema-validated, and JSON-only.
- Declare exact resource effects in both the manifest ceiling and function registration.
- Use `context.resources.read` or `context.resources.write`; never open a database, file, socket, or secret directly.
- Never add HTTP handlers, listeners, subprocesses, timers, sleeps, polling loops, background jobs, or mutable module-global state.
