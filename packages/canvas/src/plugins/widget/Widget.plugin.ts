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
        const [error, actors] = await ctx.config.apiService.api.actors.definitions.list();
        if(error) {
          console.error(error)
          return
        }
        console.log(actors)
        const promises = actors.map(actor => {
          return ctx.config.apiService.api.actors.definitions.get({ id: actor.id }).then(([err, res]) => {
            if (err || !res) {
              console.error(err)
              return
            }
            widgetMangerService.registerWidget({
              id: actor.id,
              dataType: 'widget',
              tool: actor.tool,
              actor: {
                actorDefinitionId: actor.id,
              },
              sandbox: {
                // @ts-expect-error TODO: must fix sourceFiles to require main.ts
                arrowjs: res.widget.sourceFiles
              }
            })
          })
        })
        await Promise.all(promises)
        actors.forEach(actor => {
          // widgetMangerService.registerWidget({
          //   id: 'test',
          //   dataType: 'widget',
          //   tool: actor.widget.
          // })
        })
        // todo: register actors with widget manager
      })

    }
  };
}
