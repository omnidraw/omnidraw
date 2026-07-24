export const VIBECANVAS_CAPSULE_CAPABILITY_VERSION = '1.0.0';
export const VIBECANVAS_COLLABORATIVE_STATE_CAPABILITY_ID =
  'vibecanvas.widget.collaborative_state';
export const VIBECANVAS_COLLABORATIVE_STATE_CONTRACT_HASH =
  'sha256:4f1fb60c04cf513e111bae5840faf4233e47077215a32ceadf58e9d2232b18dc';

export const VIBECANVAS_COLLABORATIVE_STATE_CONTRACT_CANONICAL_JSON =
  '{"format":"vibecanvas.collaborative-state-capability.v1","operations":[{"name":"change","kind":"call","input":"change","output":"snapshot","idempotency":"non-idempotent","freeze":"cancel"},{"name":"get","kind":"call","input":"null","output":"snapshot","idempotency":"read-only","freeze":"cancel"},{"name":"subscribe","kind":"stream","input":"null","event":"snapshot","overflow":"coalesce-latest","freeze":"pause"}]}';
