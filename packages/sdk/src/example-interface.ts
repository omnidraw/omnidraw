import { html } from '@arrow-js/core';

import { actor, type TWidgetActor } from '@vibecanvas/sdk/widget';
import {
  defineActorFunctions,
  defineFx,
  defineTx,
  type TActorResourceRequirements,
  type TActorTx,
} from '@vibecanvas/sdk/actor';

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

export const exampleActorResources = {
  preferences: { kind: 'kv', required: true, scope: ['read', 'write'] },
  credentials: { kind: 'secretStore', required: false, scope: ['read'] },
  notes: {
    kind: 'db',
    required: true,
    scope: ['read'],
    operations: {
      listNotes: { effect: 'read', sql: 'SELECT id, title FROM notes', result: 'rows' },
    },
  },
} as const satisfies TActorResourceRequirements;

const todoActor = actor as TWidgetActor<TTodoContext, TTodoInput>;

export const view = (() => {
  const addTodo = (event: Event) => {
    event.preventDefault();
    const input = event.currentTarget instanceof HTMLFormElement
      ? event.currentTarget.elements.namedItem('title')
      : null;
    if (!(input instanceof HTMLInputElement)) return;

    void todoActor.sendMessage('in.addTodo', { title: input.value });
    input.value = '';
  };

  return html`
    <section>
      <header>
        <strong>Actor Todo</strong>
        <span>${() => todoActor.state.value}</span>
      </header>

      <form @submit="${addTodo}">
        <input name="title" placeholder="Add todo" />
        <button>Add</button>
      </form>

      <ul>
        ${() => todoActor.context.value.todos.map((todo) => html`
          <li class="${() => todo.completed ? 'done' : ''}">
            <label>
              <input
                type="checkbox"
                checked="${() => todo.completed}"
                @change="${(event: Event) => {
                  const checked = event.currentTarget instanceof HTMLInputElement && event.currentTarget.checked;
                  void todoActor.sendMessage('in.toggleTodo', { id: todo.id, completed: checked });
                }}"
              />
              ${todo.title}
            </label>
          </li>
        `)}
      </ul>

      <footer>
        ${() => `${todoActor.context.value.todos.length} total`}

      </footer>
    </section>
  `;
})();

export default view;

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

export const fxExampleLoadResources = defineFx<TTodoContext, Record<string, never>>(async (portal) => {
  const preference = await portal.resources.kv('preferences').get<string>('filter');
  const hasCredentials = await portal.resources.secretStore('credentials').has('accessToken');
  const notes = await portal.resources.db('notes').invoke<Array<{ id: string; title: string }>>('listNotes');
  return { preference, hasCredentials, notes };
});

export const txExampleCompareAndSetPreference = defineTx<TTodoContext, { value: string; revision: number }>(async (portal, args) => {
  return portal.resources.kv('preferences').compareAndSet({
    key: 'filter',
    expectedRevision: args.msg.revision,
    value: args.msg.value,
  });
});

export const exampleActorRegistry = defineActorFunctions<TTodoContext, Pick<TTodoInput, 'in.addTodo'>>({
  tx: {
    'tx.exampleAddTodo': txExampleAddTodo,
  },
});
