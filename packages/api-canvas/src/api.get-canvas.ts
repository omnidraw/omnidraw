import { baseCanvasOs } from './orpc';

const apiGetCanvas = baseCanvasOs.get.handler(async ({ input, context }) => {
  const result = context.db.getFullCanvas(input.params.id, { accountId: context.accountId });
  if (!result) throw new Error('Canvas not found');

  return {
    canvas: [result.canvas],
  };
});

export { apiGetCanvas };
