import {
  executeCanvasMutation,
  loadCanvasSnapshot,
} from './cmd.canvas-shared';
import { fnBuildCanvasAddCommand } from './fn.canvas-subcommand-inputs';
import type {
  ICanvasCliApi,
  TCanvasAddInput,
  TCanvasCliOutput,
} from './interface';

export async function runCanvasAddCommand(
  api: ICanvasCliApi,
  input: TCanvasAddInput,
  createCommandId: () => string,
): Promise<TCanvasCliOutput> {
  const snapshot = await loadCanvasSnapshot(api, input, 'canvas.add');
  const planned = fnBuildCanvasAddCommand(snapshot, input, createCommandId());
  return await executeCanvasMutation(api, 'canvas.add', planned, input.dryRun);
}
