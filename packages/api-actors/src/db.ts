import type { ActorDb } from '@vibecanvas/service-db/ActorDb';
import type { IDbService } from '@vibecanvas/service-db/IDbService';
import type { TActorsDbService } from './types';

function hasActorDb(db: IDbService): db is TActorsDbService {
  return 'actor' in db;
}

export function getActorsDb(db: IDbService): ActorDb {
  if (!hasActorDb(db)) {
    throw new Error('Actors API requires an actor-capable DB service');
  }

  return db.actor;
}
