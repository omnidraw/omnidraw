import {
  executeCanvasMutation,
  loadCanvasSnapshot,
} from './cmd.canvas-shared';
import { fnBuildCanvasGroupCommand } from './fn.canvas-subcommand-inputs';
import type {
  ICanvasCliApi,
  TCanvasCliOutput,
  TCanvasGroupInput,
} from './interface';

export async function runCanvasGroupCommand(
  api: ICanvasCliApi,
  input: TCanvasGroupInput,
  createCommandId: () => string,
): Promise<TCanvasCliOutput> {
  const exactInput = input.groupId
    ? input
    : { ...input, groupId: createCommandId() };
  const snapshot = await loadCanvasSnapshot(api, exactInput, 'canvas.group');
  const planned = fnBuildCanvasGroupCommand(
    snapshot,
    exactInput,
    createCommandId(),
  );
  return await executeCanvasMutation(
    api,
    'canvas.group',
    planned,
    exactInput.dryRun,
  );
}
