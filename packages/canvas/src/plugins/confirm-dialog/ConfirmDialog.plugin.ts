import type { IPlugin } from "@vibecanvas/runtime";
import { createComponent, createMemo, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { CanvasConfirmDialog } from "../../components/CanvasConfirmDialog";
import type { ConfirmDialogService, SceneService } from "../../services";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";

function mountConfirmDialog(args: {
  scene: SceneService;
  confirmDialog: ConfirmDialogService;
}) {
  const mountElement = args.scene.container.ownerDocument.createElement("div");
  mountElement.id = "confirm-dialog";
  args.scene.stage.container().appendChild(mountElement);

  const [version, setVersion] = createSignal(0);
  const syncVersion = () => {
    setVersion((value) => value + 1);
  };

  const offStateChange = args.confirmDialog.hooks.stateChange.tap(syncVersion);
  const disposeRender = render(() => {
    const request = createMemo(() => {
      version();
      return args.confirmDialog.request;
    });

    return createComponent(CanvasConfirmDialog, {
      request,
      onResolve: (confirmed) => args.confirmDialog.resolve(confirmed),
    });
  }, mountElement);

  return {
    dispose() {
      offStateChange();
      disposeRender();
      mountElement.remove();
    },
  };
}

export function createConfirmDialogPlugin(): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  let dialogMount: ReturnType<typeof mountConfirmDialog> | null = null;

  return {
    name: "confirm-dialog",
    apply(ctx) {
      const confirmDialog = ctx.services.require("confirmDialog");
      const scene = ctx.services.require("scene");

      ctx.hooks.init.tap(() => {
        dialogMount = mountConfirmDialog({ scene, confirmDialog });
      });

      ctx.hooks.destroy.tap(() => {
        confirmDialog.resolve(false);
        dialogMount?.dispose();
        dialogMount = null;
      });
    },
  };
}
