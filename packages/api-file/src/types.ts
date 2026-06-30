import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';

type TFileApiContext = {
  db: DbServiceTurso;
  requestId?: string;
};

export type { TFileApiContext };
