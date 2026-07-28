# Widget implementation

Prefer the smallest complete browser implementation. UI-only widgets start no backend process and should remain fully useful while offline when their feature allows it.

For shared published-instance state, use the build-wired collaborative-state
client from `@vibecanvas/sdk/widget`. Preview supplies a separate authoring
state session; publication supplies the instance-bound host collaboration
session. Preview state is not copied into a published instance. Treat state as
bounded JSON and handle the first atomic snapshot. Do not invent or expose a
capability selector.

```ts
import { createCollaborativeStateClient } from "@vibecanvas/sdk/widget";

const shared = createCollaborativeStateClient<{ count: number }>();
const unsubscribe = shared.subscribe((value) => {
  output.textContent = String(value.count);
});
await shared.change({ count: 1 });

// Call unsubscribe() and shared.dispose() when the widget tears down.
```

For optional server work, import a direct named function from a
`server/*.server.ts` module and call its trusted generated proxy from an event
handler. Show pending, success, and safe error states. Preview exercises the
exact active retained server artifact with the user's selected resource
bindings, including permitted side effects, before Publish. Do not expose
invocation ids, Preview or artifact ids, capability selectors, resource ids,
internal paths, or server diagnostics in normal UI.

Use collaborative state for persistent browser state and short server functions for backend work. Never create a long-lived backend loop.
