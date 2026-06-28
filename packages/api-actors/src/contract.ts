import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import { ZVibecanvasJson } from "@vibecanvas/service-actor/core/vibecanvasjson.zod"
import { ZActorDefinition, ZJson } from "@vibecanvas/service-db/model"

const ZActorDefListItem = ZVibecanvasJson.extend(ZActorDefinition.shape)
const ZActorDefResponse = z.object({
  def: ZActorDefListItem,
  widgetCode: z.object({
    content: z.string(),
    path: z.string()
  }).array()
});

const ZActorSnapshot = z.object({
  state: z.string(),
  context: ZJson
})

export const ZActorEvent = z.object({
  actorId: z.string(),
  type: z.literal('error'),
  message: z.string()
})

const actorsContract = oc.router({
  definitions: {
    list: oc.output(ZActorDefinition.array()),
    get: oc.input(z.object({ name: z.string() }))
      .output(ZActorDefResponse),
    events: oc
      .input(z.object({}))
      .route({ method: 'GET' })
      .output(eventIterator(ZActorEvent)),
  },
  instances: {
    snapshot: oc
      .input(z.object({ instanceId: z.string() }))
      .output(ZActorSnapshot),
    sendMessage: oc
      .input(z.object({ name: z.string(), payload: z.unknown(), instanceId: z.string()}))
  }
});


export {
  actorsContract,
};
