import { baseActorsOs } from './orpc';

const apiListDefinitions = baseActorsOs.definitions.list.handler(async ({ context }) => {
  const definitions = await context.db.actor.listDefinitions(context.tenant);
  return definitions.map((definition) => {
    const manifest = context.actor.getVibecanvasJson(definition.name);
    return {
      ...definition,
      version: manifest?.version,
      health: manifest ? 'ready' as const : 'error' as const,
      error: manifest ? null : {
        phase: 'definition-fetch' as const,
        code: 'WIDGET_DEFINITION_UNAVAILABLE',
        message: `Widget definition "${definition.name}" is unavailable.`,
        retryable: true,
      },
    };
  });
});

export { apiListDefinitions };
