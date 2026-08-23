import { ProcedureError } from '../procedure';
import { baseCanvasOs } from './procedure-builder';

const apiUpdateCanvas = baseCanvasOs.update.handler(async ({ input, context }) => {
  if (input.body.name === undefined) {
    const canvas = await context.db.canvas.findById({ id: input.params.id });
    if (!canvas) {
      throw new ProcedureError('NOT_FOUND', { message: 'Canvas not found' });
    }

    return canvas;
  }

  const canvas = await context.db.canvas.renameById({
    id: input.params.id,
    name: input.body.name,
  });

  if (!canvas) {
    throw new ProcedureError('NOT_FOUND', { message: 'Canvas not found' });
  }

  return canvas;
});

export { apiUpdateCanvas };
