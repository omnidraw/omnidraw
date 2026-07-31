import { eventIterator, oc, type as orpcType } from '@orpc/contract';
import type {
  TCanvasCommand,
  TCanvasEvent,
  TCanvasItemPage,
  TCanvasItemQuery,
  TCanvasItemsChangedEvent,
  TCanvasSnapshot,
} from '@omnidraw/canvas-contract';
import { ZCanvas } from '@omnidraw/service-db/model';
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

  snapshot: oc
    .input(z.object({ canvasId: z.string().min(1) }))
    .output(orpcType<TCanvasSnapshot>()),

  query: oc
    .input(orpcType<TCanvasItemQuery>())
    .output(orpcType<TCanvasItemPage>()),

  execute: oc
    .input(orpcType<TCanvasCommand>())
    .output(orpcType<TCanvasItemsChangedEvent>()),

  events: oc
    .input(z.object({
      canvasId: z.string().min(1),
      afterRevision: z.number().int().nonnegative(),
    }))
    .route({ method: 'GET' })
    .output(eventIterator(orpcType<TCanvasEvent>())),
});

export { canvasContract };
