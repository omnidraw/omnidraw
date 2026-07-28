# State and resources

Choose the narrowest state owner:

- transient interaction state: ordinary local JavaScript values and DOM updates;
- shared widget-instance state: the SDK collaborative-state client;
- protected or durable external data: a declared resource used by a short `fx` or `tx` server function.

Resource slots are logical names, never concrete identities. The user selects concrete resources and the host validates kind and permission ceilings. Inspect selected database structure before writing SQL. Use ordinary SQLite-compatible statements with bound parameters. Never interpolate values, invent tables, expose secret values, or copy resource contents into logs or collaborative state.

Draft Preview runs the same Capsule UI path with authoring collaborative/local
state that remains separate from published-instance state. Its generated
function client invokes the exact active retained Preview server artifact
against the user's real selected binding revision, including real permitted
side effects. Handle safe function/provider failures in the UI so they can also
reach the owning Preview and AI Chat diagnostic loop.

Publication revalidates the current resource selections and promotes the exact
reviewed binding plan with the retained construction. A Preview never grants
publication authority, and its authoring state is not copied into the
published widget instance.
