import type {
  TCanvasCommand,
  TCanvasSnapshot,
} from '@vibecanvas/canvas-contract';
import { fnCanvasCliError } from './fn.canvas-subcommand-inputs';
import type {
  ICanvasCliApi,
  TCanvasApiResult,
  TCanvasCliOutput,
  TCanvasSelector,
} from './interface';

export async function unwrapCanvasApiResult<T>(
  resultPromise: TCanvasApiResult<T>,
  command: string,
  fallback: string,
): Promise<T> {
  const [error, result] = await resultPromise;
  if (error !== null && error !== undefined) throw error;
  if (result === undefined) {
    throw fnCanvasCliError(command, 'CANVAS_API_RESULT_MISSING', fallback);
  }
  return result;
}

export async function resolveCanvasId(
  api: ICanvasCliApi,
  selector: TCanvasSelector,
  command: string,
): Promise<string> {
  if (selector.canvasId !== undefined) return selector.canvasId;
  const query = selector.canvasNameQuery?.trim().toLowerCase();
  if (!query) {
    throw fnCanvasCliError(
      command,
      'CANVAS_SELECTOR_REQUIRED',
      'Choose --canvas <id> or --canvas-name <query>.',
    );
  }
  const canvases = await unwrapCanvasApiResult(
    api.list(),
    command,
    'Canvas list is unavailable.',
  );
  const matches = canvases.filter((canvas) => (
    canvas.name.toLowerCase().includes(query)
  ));
  if (matches.length === 0) {
    throw fnCanvasCliError(
      command,
      'CANVAS_NOT_FOUND',
      `No canvas name contains '${selector.canvasNameQuery}'.`,
      'Run vibecanvas canvas list to inspect accessible canvases.',
    );
  }
  if (matches.length > 1) {
    throw fnCanvasCliError(
      command,
      'CANVAS_NAME_AMBIGUOUS',
      `Canvas name query '${selector.canvasNameQuery}' matched ${matches.length} canvases.`,
      'Use --canvas with one exact canvas id.',
    );
  }
  return matches[0]!.id;
}

export async function loadCanvasSnapshot(
  api: ICanvasCliApi,
  selector: TCanvasSelector,
  command: string,
): Promise<TCanvasSnapshot> {
  const canvasId = await resolveCanvasId(api, selector, command);
  return await unwrapCanvasApiResult(
    api.snapshot({ canvasId }),
    command,
    `Canvas '${canvasId}' snapshot is unavailable.`,
  );
}

export async function executeCanvasMutation(
  api: ICanvasCliApi,
  commandName: string,
  planned: TCanvasCommand,
  dryRun: boolean,
): Promise<TCanvasCliOutput> {
  if (dryRun) {
    return {
      text: `Dry run: ${commandName} would submit ${planned.operations.length} operation(s).\n${JSON.stringify(planned, null, 2)}`,
      payload: {
        ok: true,
        command: commandName,
        dryRun: true,
        canvasId: planned.canvasId,
        baseRevision: planned.baseRevision,
        request: planned,
      },
    };
  }
  const event = await unwrapCanvasApiResult(
    api.execute(planned),
    commandName,
    `${commandName} did not return a canvas event.`,
  );
  return {
    text: `${commandName} committed revision ${event.revision}; changed ${event.changedItems.length}, deleted ${event.deletedItemIds.length}.`,
    payload: {
      ok: true,
      command: commandName,
      dryRun: false,
      canvasId: event.canvasId,
      commandId: event.commandId,
      revision: event.revision,
      changedItems: event.changedItems,
      deletedItemIds: event.deletedItemIds,
    },
  };
}
