import type { IPlugin } from "@vibecanvas/runtime";
import type {
  IRuntimeConfig,
  IRuntimeHooks,
  IRuntimeServices,
} from "../../types";

/**
 * Projection lifecycle observer. SceneService owns initial hydration and every
 * local/remote authoritative projection.
 */
export function createSceneHydratorPlugin(): IPlugin<
  IRuntimeServices,
  IRuntimeHooks,
  IRuntimeConfig
> {
  return {
    name: "scene-hydrator",
    apply(ctx) {
      const logging = ctx.services.require("logging");
      const scene = ctx.services.require("scene");
      const disposers: Array<() => unknown> = [];

      ctx.hooks.init.tap(() => {
        logging.log({
          kind: "plugin",
          name: "scene-hydrator",
          level: 1,
          event: "projection-owner-ready",
          payload: {
            sceneState: scene.state,
            diagnostics: scene.diagnostics().length,
          },
        });
        disposers.push(
          scene.hooks.projection.tap((result) => {
            const log = result.status === "failed"
              ? logging.error.bind(logging)
              : logging.log.bind(logging);
            log({
              kind: "plugin",
              name: "scene-hydrator",
              level: 2,
              event: `projection-${result.status}`,
              payload: result,
            });
          }),
          scene.hooks.diagnostic.tap((diagnostic) => {
            const log = diagnostic.severity === "error"
              ? logging.error.bind(logging)
              : logging.warn.bind(logging);
            log({
              kind: "plugin",
              name: "scene-hydrator",
              level: 1,
              event: diagnostic.code,
              payload: diagnostic,
            });
          }),
        );
      });

      ctx.hooks.elementDefinitionInvalidated.tap((event) => {
        logging.warn({
          kind: "plugin",
          name: "scene-hydrator",
          level: 1,
          event: "definition-invalidated",
          payload: {
            elementIds: [...event.elementIds],
            projectionOwner: "scene",
          },
        });
      });

      ctx.hooks.destroy.tap(() => {
        for (const dispose of disposers.splice(0).reverse()) {
          dispose();
        }
      });
    },
  };
}
