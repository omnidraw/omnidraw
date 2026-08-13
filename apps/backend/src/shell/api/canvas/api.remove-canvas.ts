import { ProcedureError } from '../procedure';
import { baseCanvasOs } from './procedure-builder';

const apiRemoveCanvas = baseCanvasOs.remove.handler(async ({ context, input }) => {
  const canvas = await context.db.canvas.findById(input.params);
  if (!canvas) {
    throw new ProcedureError('NOT_FOUND', { message: 'Canvas not found' });
  }

  const result = await context.db.canvas.deleteById(input.params);
  if (result.length === 0) {
    throw new ProcedureError('NOT_FOUND', { message: 'Canvas not found' });
  }
  await context.canvas.release({ canvasId: canvas.id });
  return result[0];
});

export { apiRemoveCanvas };
