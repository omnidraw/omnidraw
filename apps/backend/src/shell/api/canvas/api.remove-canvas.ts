import { ProcedureError } from '../procedure';
import { baseCanvasOs } from './procedure-builder';

const apiRemoveCanvas = baseCanvasOs.remove.handler(async ({ context, input }) => {
  void context;
  void input;
  throw new ProcedureError('INTERNAL_SERVER_ERROR', {
    message: 'Canvas deletion is owned by the semantic transport adapter.',
  });
});

export { apiRemoveCanvas };
