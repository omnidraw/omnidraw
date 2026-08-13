import { Context, type Effect } from 'effect';

export type TCanvasRecord = Readonly<{
  id: string;
  name: string;
  revision: number;
  createdAtSec: string;
  updatedAtSec: string;
}>;

export class DatabaseProgramError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DatabaseProgramError';
    this.code = code;
  }
}

export interface IDatabaseAuthority {
  readonly listCanvases: () => Effect.Effect<readonly TCanvasRecord[], DatabaseProgramError>;
  readonly findCanvas: (
    args: Readonly<{ canvasId: string }>,
  ) => Effect.Effect<TCanvasRecord | null, DatabaseProgramError>;
}

export class DatabaseAuthority extends Context.Service<DatabaseAuthority, IDatabaseAuthority>()(
  'omnidraw/backend/DatabaseAuthority',
) {}
