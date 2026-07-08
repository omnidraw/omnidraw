import type { IPlugin } from "@vibecanvas/runtime";
import { fnResolveWidgetToolIcon } from "../../services/widget/fn.resolve-widget-tool-icon";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";

export function createWidgetPlugin(): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "widget-plugin",
    apply(ctx) {
      const widgetMangerService = ctx.services.require('widgetManager')
      const registerActorDefinition = async (name: string) => {
        const [error, actor] = await ctx.config.apiService.api.actors.definitions.get({ name })
        if (error) {
          console.error(error)
          return
        }

        const arrowjs = actor.widgetCode.reduce((p, c) => {
          p[c.path] = c.content
          return p
        }, {} as { [path: string]: string })

        widgetMangerService.registerWidget({
          id: actor.def.name,
          dataType: 'widget',
          tool: {
            ...actor.def.widget.tool,
            icon: fnResolveWidgetToolIcon(actor.def.widget.tool.icon),
          },
          actor: {
            actorDefinitionName: actor.def.name,
          },
          sandbox: {
            // @ts-expect-error asumes that main.ts and main.css exists
            arrowjs
          }
        })
        ctx.hooks.widgetRegister.call({ kind: actor.def.name })
      }
      const registerPublishedWidgets = async () => {
        const [error, actorDefs] = await ctx.config.apiService.api.actors.definitions.list();
        if (error) {
          console.error(error)
          return
        }
        await Promise.all(actorDefs.map((actorDef) => registerActorDefinition(actorDef.name)))
      }
      ctx.hooks.initAsync.tapPromise(async () => {
        await registerPublishedWidgets()
      })

      ctx.hooks.init.tap(() => {
        const eventsEndpoint = ctx.config.apiService.api.agent?.events
        if (!eventsEndpoint) return

        let disposed = false
        void eventsEndpoint({}).then(async ([error, events]) => {
          if (error) {
            console.error(error)
            return
          }

          for await (const event of events) {
            if (disposed) break
            if (!('kind' in event) || event.kind !== 'widgetupdate') continue

            await registerPublishedWidgets()
          }
        })

        ctx.hooks.destroy.tap(() => {
          disposed = true
        })
      })

    }
  };
}
