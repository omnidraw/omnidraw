import { ACTOR_TODO_SLUG, ACTOR_TODO_VERSION } from "./CONSTANTS";

export const ACTOR_TODO_REVISION = {
  name: "Todo",
  slug: ACTOR_TODO_SLUG,
  description: "Built-in actor-backed Todo example.",
  version: ACTOR_TODO_VERSION,
  revisionHash: `builtin:${ACTOR_TODO_SLUG}:${ACTOR_TODO_VERSION}`,
  machineConfig: {
    initialState: "ready",
    initialContext: { items: [] },
    on: {
      "todo.add": {},
      "todo.toggle": {},
      "todo.remove": {},
      "todo.clearCompleted": {},
    },
  },
  contractSchema: {
    messages: {
      "todo.add": { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false },
      "todo.toggle": { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
      "todo.remove": { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
      "todo.clearCompleted": { type: "object", properties: {}, additionalProperties: false },
    },
  },
  outputSchema: {},
  serverManifest: { kind: "builtin", handler: "todo" },
  uiManifest: { kind: "builtin", widget: "todo" },
};
