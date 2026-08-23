import { eventIterator, pc } from '../procedure';
import {
  CanvasCommandCodec,
  CanvasDocumentCodec,
  CanvasEventCodec,
  CanvasItemPageCodec,
  CanvasQueryCodec,
} from '@omnidraw/canvas-contract';
import { ZCanvas } from '#backend/shell/database/model';
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

const canvasDeletionPlanSchema = z.object({
  canvas: ZCanvas,
  itemCount: z.number().int().nonnegative(),
  mediaCount: z.number().int().nonnegative(),
  retainedChatCount: z.number().int().nonnegative(),
});

const canvasDeletionResultSchema = z.object({
  canvas: ZCanvas,
  cleanup: z.object({
    itemCount: z.number().int().nonnegative(),
    mediaCount: z.number().int().nonnegative(),
    retainedChatCount: z.number().int().nonnegative(),
  }),
});

const canvasContract = pc.router({
  list: pc.output(ZCanvas.array()),

  get: pc
    .input(z.object({ params: z.object({ id: z.string() }) }))
    .output(getCanvasByIdResponseSchema),

  create: pc
    .input(createCanvasInputSchema)
    .output(ZCanvas),

  update: pc
    .input(z.object({ params: z.object({ id: z.string() }), body: updateCanvasInputSchema }))
    .output(ZCanvas),

  deletionPlan: pc
    .input(z.object({ canvasId: z.string().min(1) }))
    .output(canvasDeletionPlanSchema),

  remove: pc
    .input(z.object({
      deletionId: z.string().min(1),
      plan: canvasDeletionPlanSchema,
    }))
    .output(canvasDeletionResultSchema),

  snapshot: pc
    .input(z.object({ canvasId: z.string().min(1) }))
    .output(CanvasDocumentCodec),

  query: pc
    .input(CanvasQueryCodec)
    .output(CanvasItemPageCodec),

  execute: pc
    .input(CanvasCommandCodec)
    .output(CanvasEventCodec),

  events: pc
    .input(z.object({
      canvasId: z.string().min(1),
      afterRevision: z.number().int().nonnegative(),
    }))
    .route({ method: 'GET' })
    .output(eventIterator(CanvasEventCodec)),
});

export { canvasContract };
