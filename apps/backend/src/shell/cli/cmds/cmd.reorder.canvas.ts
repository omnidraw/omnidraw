import {
  executeCanvasMutation,
  loadCanvasSnapshot,
} from './cmd.canvas-shared';
import { fnBuildCanvasReorderCommand } from './fn.canvas-subcommand-inputs';
import type {
  ICanvasCliApi,
  TCanvasCliOutput,
  TCanvasReorderInput,
} from './interface';

export async function runCanvasReorderCommand(
  api: ICanvasCliApi,
  input: TCanvasReorderInput,
  createCommandId: () => string,
): Promise<TCanvasCliOutput> {
  const snapshot = await loadCanvasSnapshot(api, input, 'canvas.reorder');
  const planned = fnBuildCanvasReorderCommand(
    snapshot,
    input,
    createCommandId(),
  );
  return await executeCanvasMutation(
    api,
    'canvas.reorder',
    planned,
    input.dryRun,
  );
}
