import {
  executeCanvasMutation,
  loadCanvasSnapshot,
} from './cmd.canvas-shared';
import { fnBuildCanvasPatchCommand } from './fn.canvas-subcommand-inputs';
import type {
  ICanvasCliApi,
  TCanvasCliOutput,
  TCanvasPatchInput,
} from './interface';

export async function runCanvasPatchCommand(
  api: ICanvasCliApi,
  input: TCanvasPatchInput,
  createCommandId: () => string,
): Promise<TCanvasCliOutput> {
  const snapshot = await loadCanvasSnapshot(api, input, 'canvas.patch');
  const planned = fnBuildCanvasPatchCommand(snapshot, input, createCommandId());
  return await executeCanvasMutation(api, 'canvas.patch', planned, input.dryRun);
}
