import { ORPCError } from '@orpc/server';
import { getActorsDrizzleDb } from './db';
import { fxCanListActorDefinitions, fxGetActorDefinition } from './fx.actor-db';
import { fnWithActorDefinitionSourceFiles } from './fn.actor-input';
import { baseActorsOs } from './orpc';

const apiGetActorDefinition = baseActorsOs.definitions.get.handler(async ({ input, context }) => {
  if (!fxCanListActorDefinitions({ db: getActorsDrizzleDb(context.db) }, { accountId: context.accountId })) {
    throw new ORPCError('FORBIDDEN', { message: 'Cannot get actor definition' });
  }

  const definition = fxGetActorDefinition({ db: getActorsDrizzleDb(context.db) }, { id: input.id });
  if (!definition) return null;

  const widgetSource = context.actor?.getWidgetSource(definition.slug);
  return fnWithActorDefinitionSourceFiles({
    definition,
    sourceFiles: widgetSource ? { ...widgetSource.widget.files } : {},
  });
});

export { apiGetActorDefinition };
