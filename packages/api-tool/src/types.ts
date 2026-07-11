import type { DbServiceTurso } from "@vibecanvas/service-db/DbServiceTurso/DbServiceTurso";

export type TToolApiContext = {
  accountId?: string;
  db: DbServiceTurso;
  requestId?: string;
};
