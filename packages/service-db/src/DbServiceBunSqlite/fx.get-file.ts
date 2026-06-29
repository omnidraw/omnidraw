/* eslint-disable functional-core/import-boundary -- legacy db read helper uses drizzle runtime imports */
import { and, eq } from 'drizzle-orm';
import type { TFileRecord, TGetFileArgs } from '../IDbService';
import type { TDrizzleDb } from './index';

type TPortal = {
  drizzle: TDrizzleDb;
};

function fxGetFile(portal: TPortal, args: TGetFileArgs): TFileRecord | null {
  return portal.drizzle.query.files.findFirst({
    where: (table) => and(
      eq(table.id, args.id),
      eq(table.format, args.format),
    ),
  }).sync() ?? null;
}

export { fxGetFile };
