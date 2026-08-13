# State and resources

Choose the narrowest state owner:

- transient interaction state: ordinary local JavaScript values and DOM updates;
- shared widget-instance state: the SDK collaborative-state client;
- protected or durable external data: a declared resource used by a short `fx` or `tx` server function.

Resource slots are logical names for server code, but each manifest requirement
must also name its exact local `resourceId`. Discover a resource by name, inspect
it to obtain that safe id, then write the id into the requirement in
`omnidraw.json`. The host resolves only that exact ready resource and validates
its kind and permission ceiling; it never guesses by name, chooses a compatible
resource, or stores a per-widget-instance choice. Inspect selected database
structure before writing SQL. Use ordinary SQLite-compatible statements with
bound parameters. Never interpolate values, invent tables, expose secret
values, or copy resource contents into logs or collaborative state.

Draft Preview runs the same Capsule UI path with authoring collaborative/local
state that remains separate from published-instance state. Its generated
function client may invoke the exact current process-owned Preview server
output against the manifest's exact ready resource ids, including real
permitted side effects. Handle safe function/provider failures in the UI.
After check/build acceptance, use host-aware Preview inspection with a targeted
assertion to exercise permitted reads. A successful resource-free artifact
inspection is never evidence that the manifest resource or actual Preview
works. Preview inspection never receives a resource id in tool input and never
auto-approves a protected write.

Published resource links live only in the immutable accepted manifest. All
instances of the same published revision use the same links; changing a link
is a manifest edit followed by check, build, host acceptance, and user-driven
publication. Preview never grants publication authority, and its authoring
state is not copied into a published widget instance.
