# State and resources

Choose the narrowest state owner:

- transient interaction state: ordinary local JavaScript values and DOM updates;
- shared widget-instance state: the SDK collaborative-state client;
- protected or durable external data: a declared resource used by a short `fx` or `tx` server function.

Resource slots are logical names, never concrete identities. The user selects concrete resources and the host validates kind and permission ceilings. Inspect selected database structure before writing SQL. Use ordinary SQLite-compatible statements with bound parameters. Never interpolate values, invent tables, expose secret values, or copy resource contents into logs or collaborative state.

Draft Preview runs the same Capsule UI path with authoring collaborative/local
state that remains separate from published-instance state. Its generated
function client may invoke the exact current process-owned Preview server
output against process-owned resource choices, including real permitted side
effects. Handle safe function/provider failures in the UI.

Published resource choices live on concrete canvas items. Portable manifests
declare only slots and effect ceilings. Preview never grants publication
authority, and its authoring state is not copied into a published widget
instance.
