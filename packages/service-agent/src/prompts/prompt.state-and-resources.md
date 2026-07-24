# State and resources

Choose the narrowest state owner:

- transient interaction state: ordinary local JavaScript values and DOM updates;
- shared widget-instance state: the SDK collaborative-state client;
- protected or durable external data: a declared resource used by a short `fx` or `tx` server function.

Resource slots are logical names, never concrete identities. The user selects concrete resources and the host validates kind and permission ceilings. Inspect selected database structure before writing SQL. Use ordinary SQLite-compatible statements with bound parameters. Never interpolate values, invent tables, expose secret values, or copy resource contents into logs or collaborative state.

Draft Preview runs the same Capsule UI path with ephemeral collaborative state.
Server functions fail with a safe unavailable result, resources receive no real
authority, and ephemeral local state is not restored. Publication validates the
current resource selections and commits revision-scoped bindings
independently; a Preview never grants publication authority.
