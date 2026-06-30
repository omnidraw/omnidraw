import type { IPlugin } from "@vibecanvas/runtime";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";

export function createWidgetPlugin(): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "widget-plugin",
    apply(ctx) {
      const widgetMangerService = ctx.services.require('widgetManager')
      ctx.hooks.initAsync.tapPromise(async () => {
        const [error, actorDefs] = await ctx.config.apiService.api.actors.definitions.list();
        if (error) {
          console.error(error)
          return
        }
        const promises = actorDefs.map(async actorDef => {
          const [error, actor] = await ctx.config.apiService.api.actors.definitions.get({ name: actorDef.name })
          if(error) {

            return
          }

          const arrowjs =  actor.widgetCode.reduce((p, c) => {
            p[c.path] = c.content
            return p
          }, {} as {[path: string]: string})

          widgetMangerService.registerWidget({
            id: actor.def.name,
            dataType: 'widget',
            tool: actor.def.widget.tool,
            actor: {
              actorDefinitionName: actor.def.name,
            },
            sandbox: {
              // @ts-expect-error asumes that main.ts and main.css exists
              arrowjs
            }
          })
          ctx.hooks.widgetRegister.call({ kind: actor.def.name })
        })
        await Promise.all(promises)
      })

    }
  };
}
