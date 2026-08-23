import {
  executeCanvasMutation,
  loadCanvasSnapshot,
} from './cmd.canvas-shared';
import { fnBuildCanvasUngroupCommand } from './fn.canvas-subcommand-inputs';
import type {
  ICanvasCliApi,
  TCanvasCliOutput,
  TCanvasUngroupInput,
} from './interface';

export async function runCanvasUngroupCommand(
  api: ICanvasCliApi,
  input: TCanvasUngroupInput,
  createCommandId: () => string,
): Promise<TCanvasCliOutput> {
  const snapshot = await loadCanvasSnapshot(api, input, 'canvas.ungroup');
  const planned = fnBuildCanvasUngroupCommand(
    snapshot,
    input,
    createCommandId(),
  );
  return await executeCanvasMutation(
    api,
    'canvas.ungroup',
    planned,
    input.dryRun,
  );
}
