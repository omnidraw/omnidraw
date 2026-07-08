import { baseActorsOs } from './orpc';

const apiListDefinitions = baseActorsOs.definitions.list.handler(async ({ context }) => {
  const definitions = await context.db.actor.listDefinitions();
  return definitions.map((definition) => ({
    ...definition,
    version: context.actor.getVibecanvasJson(definition.name)?.version,
  }));
});

export { apiListDefinitions };
