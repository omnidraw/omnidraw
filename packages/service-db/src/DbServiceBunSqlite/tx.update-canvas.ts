/* eslint-disable functional-core/import-boundary -- legacy db write helper uses drizzle/schema runtime imports */
import { eq } from 'drizzle-orm';
import type { TCanvasRecord, TUpdateCanvasArgs } from '../IDbService';
import * as schema from '../schema';
import type { TDrizzleDb } from './index';

type TPortal = {
  drizzle: TDrizzleDb;
};

function txUpdateCanvas(portal: TPortal, args: TUpdateCanvasArgs): TCanvasRecord | null {
  if (args.name === undefined) {
    return portal.drizzle.query.canvas.findFirst({
      where: eq(schema.canvas.id, args.id),
    }).sync() ?? null;
  }

  const result = portal.drizzle
    .update(schema.canvas)
    .set({ name: args.name })
    .where(eq(schema.canvas.id, args.id))
    .returning()
    .all();

  return result[0] ?? null;
}

export { txUpdateCanvas };
