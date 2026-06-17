import { baseActorsOs } from './orpc';

const apiListDefinitions = baseActorsOs.definitions.list.handler(async ({ context }) => {
  return await context.db.actor.listDefinitions();
});

export { apiListDefinitions };
