import {
  executeCanvasMutation,
  loadCanvasSnapshot,
} from './cmd.canvas-shared';
import { fnBuildCanvasMoveCommand } from './fn.canvas-subcommand-inputs';
import type {
  ICanvasCliApi,
  TCanvasCliOutput,
  TCanvasMoveInput,
} from './interface';

export async function runCanvasMoveCommand(
  api: ICanvasCliApi,
  input: TCanvasMoveInput,
  createCommandId: () => string,
): Promise<TCanvasCliOutput> {
  const snapshot = await loadCanvasSnapshot(api, input, 'canvas.move');
  const planned = fnBuildCanvasMoveCommand(snapshot, input, createCommandId());
  return await executeCanvasMutation(api, 'canvas.move', planned, input.dryRun);
}
