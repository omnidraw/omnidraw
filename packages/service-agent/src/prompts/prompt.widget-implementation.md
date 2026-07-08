# Widget UI rules after approval

Widget UI runs in `@arrow-js/sandbox`. It is not a normal browser app. Keep it simple.

## Widget imports

```ts
import { html, reactive } from "@arrow-js/core";
import { actor } from "@vibecanvas/sdk/widget";
```

Do not import from `@vibecanvas/sdk` without `/widget`. Do not import host bridge modules, ORPC clients, canvas services, Automerge, Bun, fs, node modules, or backend packages.

## Widget SDK

Use only:

- `actor.state.value`: reactive actor state.
- `actor.context.value`: reactive actor data/context.
- `actor.sendMessage(name, payload)`: send input message to this widget's actor.

## Implementation rules

- Export a default `html` template from `widget/main.ts`.
- Put styles in `widget/main.css`.
- The widget is placed inside a rectangular canvas frame. Do not use rounded corners on the outermost/root element; keep the root rectangular and let inner elements use rounding only when useful.
- Use functions inside templates for reactive reads: `${() => actor.state.value}`.
- Send only messages declared in `vibecanvas.json`.
- Payloads must be JSON values that match the manifest input schema.
- Do not assume `actor.context.value` exists on first render; use fallbacks.
- Do not use React/Solid/Vue/Svelte or JSX.
- Do not directly use `document`, `window`, or `fetch` unless the user explicitly asks and it is safe.
- Do not expose raw actor ids or internal runtime details.

## Reliable widget pattern

```ts
import { html, reactive } from "@arrow-js/core";
import { actor } from "@vibecanvas/sdk/widget";

const ui = reactive({ title: "" });

const todos = () => ((actor.context.value as any)?.todos ?? []);

const addTodo = async () => {
  const title = ui.title.trim();
  if (!title) return;
  await actor.sendMessage("in.addTodo", { title });
  ui.title = "";
};

export default html`
  <section class="todo-widget">
    <header>
      <strong>Todos</strong>
      <small>${() => actor.state.value}</small>
    </header>
    <form @submit="${(event: Event) => { event.preventDefault(); void addTodo(); }}">
      <input
        value="${() => ui.title}"
        @input="${(event: Event) => { ui.title = (event.target as HTMLInputElement).value; }}"
      />
      <button type="submit">Add</button>
    </form>
    <ul>
      ${() => todos().map((todo: any) => html`
        <li>
          <button @click="${() => actor.sendMessage("in.toggleTodo", { id: todo.id })}">
            ${() => todo.done ? "✓" : "○"}
          </button>
          <span>${todo.title}</span>
        </li>
      `.key(todo.id))}
    </ul>
  </section>
`;
```
