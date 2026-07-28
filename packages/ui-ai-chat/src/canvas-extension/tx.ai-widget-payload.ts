import type { TWidgetFrameNode } from '@omnidraw/cangine';
import type { IStandardCanvasEditor } from '@omnidraw/cangine/editor';
import {
  fnAiWidgetPayloadEquals,
  fnWithAiWidgetPayload,
  type TAiWidgetPayload,
} from './fn.canvas-widget';

export type TPortal = Readonly<{
  editor: IStandardCanvasEditor;
}>;

export type TArgs = Readonly<{
  node: Readonly<TWidgetFrameNode>;
  payload: TAiWidgetPayload;
}>;

export function txPersistAiWidgetPayload(
  portal: TPortal,
  args: TArgs,
): void {
  if (fnAiWidgetPayloadEquals(args.node, args.payload)) return;
  portal.editor.commitSceneMutation({
    source: 'vibecanvas:ai-chat',
    commands: [{
      type: 'upsert',
      node: fnWithAiWidgetPayload(args.node, args.payload),
    }],
  });
}
