import { SERIALIZED_OPERATION_SCOPES } from './serialized-operation-context';

type TEffects = Readonly<{
  scope: object;
}>;

type TArgs<TResult> = Readonly<{
  operation: () => Promise<TResult>;
}>;

const operationTails = new WeakMap<object, Promise<void>>();

/** Serializes async operations that share an injected mutable scope. */
export function runSerializedOperation<TResult>(
  effects: TEffects,
  args: TArgs<TResult>,
): Promise<TResult> {
  const activeScopes = SERIALIZED_OPERATION_SCOPES.getStore();
  if (activeScopes?.get(effects.scope)?.active === true) {
    return args.operation();
  }
  const run = async () => {
    const scopes = new Map(activeScopes);
    const lease = { active: true };
    scopes.set(effects.scope, lease);
    return SERIALIZED_OPERATION_SCOPES.run(scopes, async () => {
      try {
        return await args.operation();
      } finally {
        lease.active = false;
      }
    });
  };
  const previous = operationTails.get(effects.scope) ?? Promise.resolve();
  const result = previous.then(run, run);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  operationTails.set(effects.scope, tail);
  void tail.then(() => {
    if (operationTails.get(effects.scope) === tail) {
      operationTails.delete(effects.scope);
    }
  });
  return result;
}

export type { TArgs, TEffects };
