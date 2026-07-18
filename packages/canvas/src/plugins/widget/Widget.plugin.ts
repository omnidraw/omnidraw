import type { IPlugin } from "@vibecanvas/runtime";
import { fnResolveWidgetToolIcon } from "../../services/widget/fn.resolve-widget-tool-icon";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";

export function createWidgetPlugin(): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "widget-plugin",
    apply(ctx) {
      const widgetMangerService = ctx.services.require('widgetManager')
      const registeredPublishedWidgetNames = new Set<string>()
      const registerActorDefinition = async (name: string) => {
        const [error, actor] = await ctx.config.apiService.api.actors.definitions.get({ name })
        if (error) {
          widgetMangerService.setDefinitionError(name, {
            phase: 'definition-fetch',
            code: 'WIDGET_DEFINITION_UNAVAILABLE',
            message: `Could not load widget definition "${name}".`,
            retryable: true,
          })
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
        registeredPublishedWidgetNames.add(actor.def.name)
        ctx.hooks.widgetRegister.call({ kind: actor.def.name })
      }
      const registerPublishedWidgets = async () => {
        const [error, actorDefs] = await ctx.config.apiService.api.actors.definitions.list();
        if (error) {
          widgetMangerService.setGlobalDefinitionError({
            phase: 'definition-discovery',
            code: 'WIDGET_DEFINITION_UNAVAILABLE',
            message: 'Published widget definitions could not be loaded.',
            retryable: true,
          })
          widgetMangerService.completeDefinitionDiscovery()
          return
        }
        widgetMangerService.setGlobalDefinitionError(null)
        const nextDefinitionNames = new Set(actorDefs.map((actorDef) => actorDef.name))
        registeredPublishedWidgetNames.forEach((name) => {
          if (nextDefinitionNames.has(name)) {
            return
          }

          widgetMangerService.unregisterWidget(name)
          registeredPublishedWidgetNames.delete(name)
        })
        await Promise.all(actorDefs.map((actorDef) => {
          if (actorDef.health === 'error') {
            widgetMangerService.setDefinitionError(actorDef.name, actorDef.error ?? {
              phase: 'definition-fetch',
              code: 'WIDGET_DEFINITION_UNAVAILABLE',
              message: `Could not load widget definition "${actorDef.name}".`,
              retryable: true,
            });
            return Promise.resolve();
          }
          return registerActorDefinition(actorDef.name);
        }))
        widgetMangerService.completeDefinitionDiscovery()
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
            if (!('kind' in event) || (event.kind !== 'widgetupdate' && event.kind !== 'widget-published')) continue

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
