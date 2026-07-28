import type {
  TNodeId,
  TSerializedSceneCommand,
} from '@omnidraw/cangine';
import type { IStandardCanvasEditor } from '@omnidraw/cangine/editor';
import {
  fnSceneNodesEqual,
} from '../../services/fn.scene-node-diff';
import {
  fnApplySelectionStyle,
  type TSelectionStylePatch,
} from './fn.selection-style';

export type TPortal = Readonly<{
  editor: IStandardCanvasEditor;
}>;

export type TArgs = Readonly<{
  nodeIds: readonly TNodeId[];
  patch: TSelectionStylePatch;
}>;

export function txApplySelectionStyle(portal: TPortal, args: TArgs): void {
  const commands: TSerializedSceneCommand[] = [];
  for (const nodeId of args.nodeIds) {
    const node = portal.editor.engine.scene.get(nodeId);
    if (node === null) continue;
    const next = fnApplySelectionStyle(node, args.patch);
    if (fnSceneNodesEqual(node, next)) continue;
    commands.push({
      type: 'upsert',
      node: next,
    });
  }
  if (commands.length === 0) return;
  portal.editor.commitSceneMutation({
    source: 'vibecanvas:selection-style',
    coalesceKey: 'vibecanvas:selection-style',
    commands,
  });
}
