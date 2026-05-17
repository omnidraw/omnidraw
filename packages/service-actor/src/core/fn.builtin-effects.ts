import type { TActorBundleManifest, TActorJson, TActorMessage, TActorOutput } from './types';

export type TArgsApplyBuiltinActorEffects = {
  readonly manifest: unknown;
  readonly context: TActorJson;
  readonly message: TActorMessage;
  readonly effects: readonly string[];
};

export type TApplyBuiltinActorEffectsResult =
  | { readonly handled: false }
  | { readonly handled: true; readonly context: TActorJson; readonly outputs: readonly TActorOutput[] };

type TTodoItem = {
  readonly id: string;
  readonly title: string;
  readonly completed: boolean;
};

function jsonRecord(value: TActorJson): Record<string, TActorJson | undefined> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function todoItems(value: TActorJson | undefined): readonly TTodoItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is TTodoItem => {
    return Boolean(item)
      && typeof item === 'object'
      && !Array.isArray(item)
      && typeof item.id === 'string'
      && typeof item.title === 'string'
      && typeof item.completed === 'boolean';
  });
}

function textParam(message: TActorMessage, key: string): string {
  const payload = message.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  const value = payload[key];
  return typeof value === 'string' ? value.trim() : '';
}

function nextTodoId(args: { readonly title: string; readonly items: readonly TTodoItem[] }): string {
  const prefix = `${args.title}:`;
  const max = args.items.reduce((current, item) => {
    if (!item.id.startsWith(prefix)) return current;
    const suffix = Number(item.id.slice(prefix.length));
    return Number.isFinite(suffix) ? Math.max(current, suffix) : current;
  }, 0);
  return `${prefix}${max + 1}`;
}

function todoContext(args: { readonly context: TActorJson; readonly message: TActorMessage }): TActorJson {
  const context = jsonRecord(args.context);
  const items = todoItems(context.items);

  if (args.message.name === 'todo.add') {
    const title = textParam(args.message, 'title');
    if (!title) return context;
    return { ...context, items: [...items, { id: nextTodoId({ title, items }), title, completed: false }] };
  }

  if (args.message.name === 'todo.toggle') {
    const id = textParam(args.message, 'id');
    return { ...context, items: items.map((item) => item.id === id ? { ...item, completed: !item.completed } : item) };
  }

  if (args.message.name === 'todo.remove') {
    const id = textParam(args.message, 'id');
    return { ...context, items: items.filter((item) => item.id !== id) };
  }

  if (args.message.name === 'todo.clearCompleted') {
    return { ...context, items: items.filter((item) => !item.completed) };
  }

  return context;
}

export function fnApplyBuiltinActorEffects(args: TArgsApplyBuiltinActorEffects): TApplyBuiltinActorEffectsResult {
  const manifest = args.manifest as Partial<TActorBundleManifest> & { readonly kind?: unknown; readonly handler?: unknown };
  if (manifest.kind !== 'builtin' || manifest.handler !== 'todo') return { handled: false };
  if (!args.effects.every((effect) => effect.startsWith('tx.todo.'))) return { handled: false };
  return { handled: true, context: todoContext({ context: args.context, message: args.message }), outputs: [] };
}
