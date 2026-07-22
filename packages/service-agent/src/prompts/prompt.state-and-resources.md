# State and resources

Choose the narrowest state owner:

- transient interaction state: local Arrow `reactive()` values;
- shared widget-instance state: the SDK collaborative-state client;
- protected or durable external data: a declared resource used by a short `fx` or `tx` server function.

Resource slots are logical names, never concrete identities. The user selects concrete resources and the host validates kind and permission ceilings. Inspect selected database structure before writing SQL. Use ordinary SQLite-compatible statements with bound parameters. Never interpolate values, invent tables, expose secret values, or copy resource contents into logs or collaborative state.

Draft Preview is UI-only: server functions and resource access become available after Publish. Publication validates the current resource selections and commits revision-scoped bindings independently; a Preview never grants publication authority.
