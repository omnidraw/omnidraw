import { ORPCError } from '@orpc/contract';
import { baseActorsOs } from './orpc';

export const apiGetDefinitions = baseActorsOs.auth.get.handler(async ({ input, context }) => {
  const vcJson = context.actor.getVibecanvasJson(definition.name)
  const widgetCode = await context.actor.getWidgetCode(definition.name)

  if(vcJson === null || widgetCode === null) throw new ORPCError('NOT_FOUND')

  // all data available
  return {
    def: {...vcJson, ...definition},
    widgetCode
  }

});