import { oc } from '@orpc/contract';
import { ZCanvas } from '@vibecanvas/service-db/model';
import { z } from 'zod';

const getCanvasByIdResponseSchema = z.object({
  canvas: ZCanvas.array(),
});

const createCanvasInputSchema = z.object({
  name: z.string(),
});

const updateCanvasInputSchema = z.object({
  name: z.string().optional(),
});

const canvasContract = oc.router({
  list: oc.output(ZCanvas.array()),

  get: oc
    .input(z.object({ params: z.object({ id: z.string() }) }))
    .output(getCanvasByIdResponseSchema),

  create: oc
    .input(createCanvasInputSchema)
    .output(ZCanvas),

  update: oc
    .input(z.object({ params: z.object({ id: z.string() }), body: updateCanvasInputSchema }))
    .output(ZCanvas),

  remove: oc
    .input(z.object({ params: z.object({ id: z.string() }) }))
    .output(ZCanvas),
});

export { canvasContract };
