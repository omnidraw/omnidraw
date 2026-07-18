import type { IPlugin } from "@vibecanvas/runtime";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "@vibecanvas/canvas";
import { fnResolveWidgetToolIcon } from "../widget/fn.resolve-widget-tool-icon";
import type { TAiChatApplicationPort, TWidgetTransportPort } from "../ports";
import type { WidgetManagerService } from "../widget/WidgetManagerService";

export function createWidgetPlugin(portal: {
  application: TAiChatApplicationPort;
  transport: TWidgetTransportPort;
  widgetManager: WidgetManagerService;
}): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "widget-plugin",
    apply(ctx) {
      const widgetMangerService = portal.widgetManager
      const registeredPublishedWidgetNames = new Set<string>()
      const registerActorDefinition = async (name: string) => {
        const [error, actor] = await portal.transport.api.actors.definitions.get({ name })
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
      }
      const registerPublishedWidgets = async () => {
        const [error, actorDefs] = await portal.transport.api.actors.definitions.list();
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
        const eventsEndpoint = portal.transport.api.agent?.events
        if (!eventsEndpoint) return

        let disposed = false
        let iterator: AsyncIterator<unknown> | undefined
        const closeIterator = (candidate: AsyncIterator<unknown> | undefined) => {
          if (!candidate?.return) return
          try {
            const closing = candidate.return()
            if (closing) void Promise.resolve(closing).catch(() => undefined)
          } catch {
            // Stream cleanup must remain safe when an iterator closes synchronously.
          }
        }
        void eventsEndpoint({}).then(async ([error, events]) => {
          if (error) {
            if (!disposed) portal.application.logError(error)
            return
          }

          const currentIterator = events[Symbol.asyncIterator]()
          if (disposed) {
            closeIterator(currentIterator)
            return
          }
          iterator = currentIterator

          try {
            while (!disposed) {
              const next = await currentIterator.next()
              if (next.done || disposed) break
              const event = next.value
              if (!('kind' in event) || (event.kind !== 'widgetupdate' && event.kind !== 'widget-published')) continue

              await registerPublishedWidgets()
            }
          } finally {
            if (iterator === currentIterator) {
              iterator = undefined
              closeIterator(currentIterator)
            }
          }
        }).catch((error) => {
          if (!disposed) portal.application.logError(error)
        })

        ctx.hooks.destroy.tap(() => {
          disposed = true
          const activeIterator = iterator
          iterator = undefined
          closeIterator(activeIterator)
        })
      })

    }
  };
}
