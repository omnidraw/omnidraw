import type { TDrizzleDb } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import type { IDbService } from '@vibecanvas/service-db/IDbService';
import type { TActorsDbService } from './types';

function hasDrizzle(db: IDbService): db is TActorsDbService {
  return 'drizzle' in db;
}

export function getActorsDrizzleDb(db: IDbService): TDrizzleDb {
  if (!hasDrizzle(db)) {
    throw new Error('Actors API requires a Drizzle-backed DB service');
  }

  return db.drizzle;
}
