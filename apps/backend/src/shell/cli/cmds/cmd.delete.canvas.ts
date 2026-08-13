import {
  executeCanvasMutation,
  loadCanvasSnapshot,
} from './cmd.canvas-shared';
import { fnBuildCanvasDeleteCommand } from './fn.canvas-subcommand-inputs';
import type {
  ICanvasCliApi,
  TCanvasCliOutput,
  TCanvasDeleteInput,
} from './interface';

export async function runCanvasDeleteCommand(
  api: ICanvasCliApi,
  input: TCanvasDeleteInput,
  createCommandId: () => string,
): Promise<TCanvasCliOutput> {
  const snapshot = await loadCanvasSnapshot(api, input, 'canvas.delete');
  const planned = fnBuildCanvasDeleteCommand(snapshot, input, createCommandId());
  return await executeCanvasMutation(api, 'canvas.delete', planned, input.dryRun);
}
