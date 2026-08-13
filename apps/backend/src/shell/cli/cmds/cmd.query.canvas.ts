import { resolveCanvasId, unwrapCanvasApiResult } from './cmd.canvas-shared';
import type {
  ICanvasCliApi,
  TCanvasCliOutput,
  TCanvasQueryInput,
} from './interface';

export async function runCanvasQueryCommand(
  api: ICanvasCliApi,
  input: TCanvasQueryInput,
): Promise<TCanvasCliOutput> {
  const canvasId = await resolveCanvasId(api, input, 'canvas.query');
  const page = await unwrapCanvasApiResult(
    api.query({
      canvasId,
      filter: input.filter,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    }),
    'canvas.query',
    `Canvas '${canvasId}' query is unavailable.`,
  );
  return {
    text: page.items.length === 0
      ? 'No canvas items matched.'
      : page.items.map((entry) => JSON.stringify(entry)).join('\n'),
    payload: {
      ok: true,
      command: 'canvas.query',
      canvasId,
      items: page.items,
      nextCursor: page.nextCursor,
    },
  };
}
