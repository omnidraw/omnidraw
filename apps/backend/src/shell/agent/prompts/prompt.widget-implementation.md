# Widget implementation

Prefer the smallest complete browser implementation. UI-only widgets start no backend process and should remain fully useful while offline when their feature allows it.

Keep transient interaction state in ordinary local JavaScript values. When a
mount-local key/value store is useful, declare `ui.state.localStore` as
`ephemeral` and use `getWidgetLocalState`, `setWidgetLocalState`,
`deleteWidgetLocalState`, and `listWidgetLocalStateKeys` from
`@omnidraw/sdk/widget`. This store is bounded, belongs only to the current
Capsule mount, and is not shared or durable. Do not use it for data that must
survive remount, reload, or publication.

For durable data, declare a resource and access it through a short `fx` or `tx`
server function. Import a direct named function from a `server/*.server.ts`
module and call its trusted generated proxy from an event handler. Show pending,
success, and safe error states. Preview exercises the exact process-owned server
output with the accepted manifest's exact resource references and independently
validated policy, including permitted side effects. Do not expose invocation
ids, Preview or artifact ids, capability selectors, resource ids, internal
paths, or server diagnostics in normal UI.

Use local state for transient browser behavior and short server functions with
declared resources for durable work. Never create a long-lived backend loop.
