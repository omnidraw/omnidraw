import { html } from '@arrow-js/core';

import type { TWidgetSdk } from '@vibecanvas/sdk/widget';
import { defineWidget } from '@vibecanvas/sdk/widget';
import { defineActorFunctions, defineTx, type TActorTx } from '@vibecanvas/sdk/actor';

type TTodoItem = {
  id: string;
  title: string;
  completed: boolean;
  priority: 'low' | 'normal' | 'high';
  notes: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type TTodoContext = {
  version: number;
  nextId: number;
  filter: 'all' | 'open' | 'done';
  todos: TTodoItem[];
};

type TTodoInput = {
  'in.addTodo': { title: string; priority?: 'low' | 'normal' | 'high'; notes?: string; now?: string };
  'in.toggleTodo': { id: string; completed: boolean; now?: string };
  'in.removeTodo': { id: string };
  'in.setFilter': { filter: 'all' | 'open' | 'done' };
};

type TTodoOutput = {
  'out.todosChanged': { total: number; open: number; done: number; highPriorityOpen: number; revision: number };
  'out.error': { code: string; message: string };
};

type TTodoUiProps = {
  compact?: boolean;
};

export type TTodoWidgetSdk = TWidgetSdk<TTodoContext, TTodoInput>;

export default defineWidget((sdk: TTodoWidgetSdk) => {
  const addTodo = (event: Event) => {
    event.preventDefault();
    const input = event.currentTarget instanceof HTMLFormElement
      ? event.currentTarget.elements.namedItem('title')
      : null;
    if (!(input instanceof HTMLInputElement)) return;

    void sdk.actor.sendMessage('in.addTodo', { title: input.value });
    input.value = '';
  };

  return html`
    <section>
      <header>
        <strong>Actor Todo</strong>
        <span>${() => sdk.actor.state.value}</span>
        <span>${() => sdk.actor.status.value}</span>
      </header>

      <form @submit="${addTodo}">
        <input name="title" placeholder="Add todo" />
        <button>Add</button>
      </form>

      <ul>
        ${() => sdk.actor.context.value.todos.map((todo) => html`
          <li class="${() => todo.completed ? 'done' : ''}">
            <label>
              <input
                type="checkbox"
                checked="${() => todo.completed}"
                @change="${(event: Event) => {
                  const checked = event.currentTarget instanceof HTMLInputElement && event.currentTarget.checked;
                  void sdk.actor.sendMessage('in.toggleTodo', { id: todo.id, completed: checked });
                }}"
              />
              ${todo.title}
            </label>
          </li>
        `)}
      </ul>

      <footer>
        ${() => `${sdk.actor.context.value.todos.length} total`}

      </footer>
    </section>
  `;
});

export const txExampleAddTodo: TActorTx<TTodoContext, TTodoInput['in.addTodo']> = defineTx(async (portal, args) => {
  const title = args.msg.title.trim();
  if (!title) {
    await portal.emitMessage({
      type: 'out.error',
      payload: { code: 'EMPTY_TITLE', message: 'Todo title cannot be empty.' },
    });
    return;
  }

  const now = args.msg.now ?? 'mock-clock';
  const nextContext: TTodoContext = {
    ...args.data,
    nextId: args.data.nextId + 1,
    todos: [
      {
        id: `todo-${args.data.nextId}`,
        title,
        completed: false,
        priority: args.msg.priority ?? 'normal',
        notes: args.msg.notes ?? '',
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      },
      ...args.data.todos,
    ],
  };

  await portal.setData(nextContext);
  await portal.emitMessage({
    type: 'out.todosChanged',
    payload: {
      total: nextContext.todos.length,
      open: nextContext.todos.filter((todo) => !todo.completed).length,
      done: nextContext.todos.filter((todo) => todo.completed).length,
      highPriorityOpen: nextContext.todos.filter((todo) => !todo.completed && todo.priority === 'high').length,
      revision: 0,
    },
  });
});

export const exampleActorRegistry = defineActorFunctions<TTodoContext, Pick<TTodoInput, 'in.addTodo'>>({
  tx: {
    'tx.exampleAddTodo': txExampleAddTodo,
  },
});
