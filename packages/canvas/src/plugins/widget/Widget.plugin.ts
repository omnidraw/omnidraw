import type { IPlugin } from "@vibecanvas/runtime";
import type { ThemeService } from "@vibecanvas/service-theme";
import type { CameraService, ElementService, GroupService, SceneService, SelectionService, WidgetManagerService } from "../../services";
import type { IRuntimeHooks, IRuntimeConfig } from "../../types";


export function createWidgetPlugin(): IPlugin<{
  camera: CameraService;
  element: ElementService;
  scene: SceneService;
  selection: SelectionService;
  theme: ThemeService;
  group: GroupService;
  widgetManager: WidgetManagerService;
}, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "widget-plugin",
    apply(ctx) {
      console.log('widget', ctx)
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

          console.log('arrowjs', arrowjs)

          widgetMangerService.registerWidget({
            id: actor.def.name,
            dataType: 'widget',
            tool: actor.def.widget.tool,
            actor: {
              actorDefinitionId: actor.def.name,
            },
            sandbox: {
              // @ts-expect-error asumes that main.ts and main.css exists
              arrowjs
            }
          })
        })
        await Promise.all(promises)
      })

    }
  };
}
