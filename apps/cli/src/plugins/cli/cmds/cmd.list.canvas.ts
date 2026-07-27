import { unwrapCanvasApiResult } from './cmd.canvas-shared';
import type { ICanvasCliApi, TCanvasCliOutput } from './interface';

export async function runCanvasListCommand(
  api: ICanvasCliApi,
): Promise<TCanvasCliOutput> {
  const canvases = [...await unwrapCanvasApiResult(
    api.list(),
    'canvas.list',
    'Canvas list is unavailable.',
  )].sort((left, right) => (
    left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  ));
  return {
    text: canvases.length === 0
      ? 'No canvases.'
      : canvases.map((canvas) => (
        `${canvas.id}\t${canvas.name}\trevision ${canvas.revision}`
      )).join('\n'),
    payload: {
      ok: true,
      command: 'canvas.list',
      canvases,
    },
  };
}
