/* eslint-disable functional-core/import-boundary -- legacy db write helper uses schema runtime imports */
import type { TCreateFileArgs, TFileRecord } from '../IDbService';
import * as schema from '../schema';
import type { TDrizzleDb } from './index';
import { fxGetFile } from './fx.get-file';

type TPortal = {
  drizzle: TDrizzleDb;
};

function txCreateFile(portal: TPortal, args: TCreateFileArgs): TFileRecord {
  portal.drizzle.insert(schema.files).values({
    id: args.id,
    hash: args.hash,
    format: args.format,
    base64: args.base64,
  }).run();

  const record = fxGetFile(portal, {
    id: args.id,
    format: args.format,
  });

  if (!record) {
    throw new Error('Failed to create file record');
  }

  return record;
}

export { txCreateFile };
