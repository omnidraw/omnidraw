import type Konva from "konva";
import { fnFilterSelection } from "../../core/fn.filter-selection";
import type { ElementService, SceneService, SelectionService, SessionService } from "../../services";
import { fxGetSelectionTransformOptions } from "./fx.selection-transform-options";

type TPortalTxSyncTransformer = {
  element: ElementService;
  session: SessionService;
  Konva: typeof Konva;
  scene: SceneService;
  selection: SelectionService;
  transformer: Konva.Transformer;
};

type TArgsTxSyncTransformer = Record<string, never>;

export function txSyncTransformer(portal: TPortalTxSyncTransformer, args: TArgsTxSyncTransformer) {
  void args;
  if (portal.session.editingId !== null) {
    portal.transformer.setNodes([]);
    portal.transformer.update();
    portal.scene.dynamicLayer.batchDraw();
    return;
  }

  const filteredSelection = fnFilterSelection({ selection: portal.selection.selection });
  const transformOptions = fxGetSelectionTransformOptions({
    Konva: portal.Konva,
    element: portal.element,
  }, {
    selection: filteredSelection,
  });

  portal.transformer.borderEnabled(transformOptions.borderEnabled);
  portal.transformer.borderDash(transformOptions.borderDash);
  portal.transformer.keepRatio(transformOptions.keepRatio);
  portal.transformer.flipEnabled(transformOptions.flipEnabled);
  portal.transformer.enabledAnchors(transformOptions.enabledAnchors);
  portal.transformer.setNodes(filteredSelection);
  portal.transformer.update();
  portal.scene.dynamicLayer.batchDraw();
}
