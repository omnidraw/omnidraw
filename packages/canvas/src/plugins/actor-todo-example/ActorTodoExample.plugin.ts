import type { IPlugin } from "@vibecanvas/runtime";
import type { ActorConnectionService, CrdtService, ToolService, WidgetManagerService } from "../../services";
import type { IRuntimeConfig, IRuntimeHooks } from "../../types";
import { ACTOR_TODO_REVISION } from "./actor.todo-definition";
import { ACTOR_TODO_SLUG, ACTOR_TODO_WIDGET_KIND } from "./CONSTANTS";
import { mountTodoWidget } from "./widget.todo-ui";

export function createActorTodoExamplePlugin(): IPlugin<{
  actorConnection: ActorConnectionService;
  crdt: CrdtService;
  tool: ToolService;
  widgetManager: WidgetManagerService;
}, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "actor-todo-example",
    apply: async (ctx) => {
      const crdt = ctx.services.require("crdt");
      const actorConnection = ctx.services.require("actorConnection");
      const tool = ctx.services.require("tool");
      const widgetManager = ctx.services.require("widgetManager");

      const [listError, revisions] = await ctx.config.apiService.api.actors.revisions.list({ slug: ACTOR_TODO_SLUG });
      const existingRevision = listError ? null : revisions?.find((revision) => revision.revision_hash === ACTOR_TODO_REVISION.revisionHash) ?? revisions?.at(-1) ?? null;
      const ensured = existingRevision
        ? { definition: null, revision: existingRevision }
        : (await ctx.config.apiService.api.actors.revisions.register(ACTOR_TODO_REVISION))[1];

      const revision = ensured?.revision;
      if (!revision) {
        ctx.config.notification?.showError("Could not register Todo actor");
        return;
      }

      widgetManager.registerWidget({
        id: ACTOR_TODO_WIDGET_KIND,
        dataType: "widget",
        tool: {
          label: "Actor Todo",
          priority: 77,
          shortcuts: ["t"],
        },
        actor: {
          actorDefinitionId: revision.actor_definition_id,
        },
        renderDom: ({ root, element }) => mountTodoWidget({
          root,
          element,
          crdt,
          actorConnection,
          apiService: ctx.config.apiService,
        }),
      });

      ctx.hooks.destroy.tap(() => {
        tool.unregisterTool(ACTOR_TODO_WIDGET_KIND);
      });
    },
  };
}
