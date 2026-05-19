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
  widget: WidgetManagerService;
}, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "widget-plugin",
    apply(ctx) {
      console.log('widget', ctx)
      const widgetMangerService = ctx.services.require('widget')
      ctx.hooks.initAsync.tapPromise(async () => {
        const [error, actors] = await ctx.config.apiService.api.actors.definitions.list();
        if(error) {
          console.error(error)
          return
        }
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
