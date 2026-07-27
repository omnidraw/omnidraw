import type {
  IInfiniteCanvasEngine,
  TNodeId,
} from '@omnidraw/cangine';
import {
  fnApplySelectionStyle,
  type TSelectionStylePatch,
} from './fn.selection-style';

export type TPortal = Readonly<{
  engine: IInfiniteCanvasEngine;
}>;

export type TArgs = Readonly<{
  nodeIds: readonly TNodeId[];
  patch: TSelectionStylePatch;
}>;

export function txApplySelectionStyle(portal: TPortal, args: TArgs): void {
  portal.engine.scene.transaction((transaction) => {
    for (const nodeId of args.nodeIds) {
      transaction.update(nodeId, (node) => (
        fnApplySelectionStyle(node, args.patch)
      ));
    }
  }, {
    source: 'vibecanvas:selection-style',
    coalesceKey: 'vibecanvas:selection-style',
  });
}
