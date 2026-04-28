# @vibecanvas/sdk

Tiny SDK for Vibecanvas guest widgets.

Guest widgets use it for three things:

- `defineActor`, `emitActor`, `onActor` — declare input/output ports and emit messages.
- `machine` — keep reactive internal state that Vibecanvas can inspect.
- `TVibecanvasWidgetConfig` — type-check `vibecanvas.config.ts`.

Vibecanvas owns sandboxing, message routing, and JSON Schema validation in the host.

## Install in a local widget

For the current local prototype, depend on the workspace checkout by file path:

```json
{
  "dependencies": {
    "@arrow-js/core": "^1.0.6",
    "@vibecanvas/sdk": "file:../../../../packages/sdk"
  }
}
```

Then run:

```sh
bun install
```

## Widget config

Use `vibecanvas.config.ts` instead of `vibecanvas.manifest.json`.

```ts
import type { TVibecanvasWidgetConfig } from "@vibecanvas/sdk";

export default {
  schemaVersion: 1,
  id: "todo-app",
  label: "Todo App",
  permissions: [],
  defaultSize: {
    width: 400,
    height: 600,
  },
  source: {
    "main.ts": "./src/main.ts",
    "main.css": "./src/main.css",
  },
  actor: {
    states: ["booting", "idle", "saving", "failed"],
    officialStates: ["booting", "ready", "busy", "error"],
    inputs: {
      addTodo: {
        label: "Add Todo",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
          required: ["title"],
          additionalProperties: false,
        },
      },
    },
    outputs: {
      todoCreated: {
        label: "Todo Created",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
          required: ["title"],
          additionalProperties: false,
        },
      },
    },
  },
} satisfies TVibecanvasWidgetConfig;
```

## Actor ports in `main.ts`

```ts
import { html, reactive } from "@arrow-js/core";
import { defineActor, emitActor } from "@vibecanvas/sdk";

const state = reactive({ todos: [] as string[] });

defineActor({
  name: "Todo App",
  inputs: {
    addTodo: {
      label: "Add Todo",
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
        },
        required: ["title"],
        additionalProperties: false,
      },
      handle(payload) {
        const todo = payload as { title: string };
        state.todos = [...state.todos, todo.title];
        emitActor("todoCreated", todo);
      },
    },
  },
  outputs: {
    todoCreated: {
      label: "Todo Created",
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
});

export default html`
  <main>
    <h1>Todos</h1>
    <ul>
      ${() => state.todos.map((todo) => html`<li>${todo}</li>`)}
    </ul>
  </main>
`;
```

## Machine state

`machine()` creates a small Arrow-reactive state machine. It always starts in `booting`.

```ts
import { html, watch } from "@arrow-js/core";
import { machine } from "@vibecanvas/sdk";

const flow = machine({
  states: {
    booting: {
      official: "booting",
      on: { READY: "idle" },
    },
    idle: {
      official: "ready",
      on: { SAVE: "saving" },
    },
    saving: {
      official: "busy",
      on: {
        DONE: "idle",
        FAIL: "failed",
      },
    },
    failed: {
      official: "error",
      on: { RETRY: "saving" },
    },
  },
});

watch(() => {
  // flow.state is reactive()
  flow.state.value;
  flow.state.official;
});

flow.send("READY");

export default html`
  <main>
    <p>Widget state: ${() => flow.state.value}</p>
    <p>Host-known state: ${() => flow.state.official}</p>
    <button @click="${() => flow.send("SAVE")}">Save</button>
  </main>
`;
```

You can also set state directly for simple widgets:

```ts
flow.set("saving", { reason: "user-click" });
flow.set("idle");
```

## Official host-known states

Vibecanvas recognizes these states across all widget types:

```ts
"booting" | "ready" | "busy" | "waiting" | "dirty" | "error" | "disabled" | "disposed"
```

Use custom widget states for your own workflow, then map each custom state to one official state:

```ts
const flow = machine({
  states: {
    editingTitle: { official: "dirty" },
    waitingForUser: { official: "waiting" },
    syncingToServer: { official: "busy" },
    crashedButRecoverable: { official: "error" },
  },
});
```

This gives Vibecanvas stable debugging/inspection across different widgets while still letting each widget define its own states and transitions.

## JSON Schema

Actor port `schema` fields are JSON Schema. Prefer simple draft-07-compatible schemas:

```ts
{
  type: "object",
  properties: {
    value: { type: "number" }
  },
  required: ["value"],
  additionalProperties: false
}
```

Vibecanvas validates payloads in the host before routing messages. Guest widgets should not bundle a JSON Schema validator.

## Theme CSS variables

Guest UI should use Vibecanvas CSS variables so it follows the active theme:

```css
:host,
.widget {
  color: var(--foreground);
  background: var(--card);
  border-color: var(--border);
}

button {
  background: var(--primary);
  color: var(--primary-foreground);
}
```
