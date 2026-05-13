import type { IPlugin } from "@vibecanvas/runtime";
import type { WidgetManagerService } from "../../services";
import type { IRuntimeConfig, IRuntimeHooks } from "src/types";
import maints from './maints.txt?raw'
import maincss from './maincss.txt?raw'

export function createTodoAppPlugin(): IPlugin<{
  widgetManager: WidgetManagerService;
}, IRuntimeHooks, IRuntimeConfig> {
  // console.log('createTodoAppPlugin', maints)
  return {
    name: "TodoApp",
    apply: async (ctx) => {
      const widgetManger = ctx.services.get('widgetManager')
      widgetManger?.registerWidget({
        id: "todo-app",
        tool: {
          label: "Todo App",
        },
        sandbox: {
          arrowjs: {
            "main.ts": maints,
            "main.css": maincss
          }
        }
      })

    },
  }
}
