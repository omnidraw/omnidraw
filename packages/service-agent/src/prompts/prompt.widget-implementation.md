# Widget implementation

Prefer the smallest complete browser implementation. UI-only widgets start no backend process and should remain fully useful while offline when their feature allows it.

For shared published-instance state, use the collaborative-state exports from `@vibecanvas/sdk/widget`. Preview supplies an ephemeral in-browser state session; publication supplies the host collaboration session. Treat the state as JSON, make bounded changes, and handle an initially empty document.

For optional server work, import a direct named function from a `server/*.server.ts` module and call its generated proxy from an event handler. Show pending, success, and safe error states. Do not expose invocation ids, artifact ids, resource ids, internal paths, or server diagnostics in normal UI.

Never import actor APIs in manifest-v2 widget code. Never create a state machine or long-lived backend loop.
