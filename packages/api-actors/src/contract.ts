import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import { ZVibecanvasJson } from "@vibecanvas/service-actor/core/vibecanvasjson.zod"
import { ZActorDefinition } from "@vibecanvas/service-db/model"

const ZActorDefListItem = ZVibecanvasJson.extend(ZActorDefinition.shape)
const ZActorDefResponse = z.object({
  def: ZActorDefListItem,
  widgetCode: z.object({
    content: z.string(),
    path: z.string()
  }).array()
});

const actorsContract = oc.router({
  definitions: {
    list: oc.output(ZActorDefinition.array()),
    get: oc.input(z.object({ name: z.string() }))
           .output(ZActorDefResponse)


  }
});


export {
  actorsContract,
};
