import { Effect } from 'effect';
import {
  DatabaseAuthority,
  type DatabaseProgramError,
  type TCanvasRecord,
} from './service.database';

export const fxListCanvases = Effect.fn('fxListCanvases')(function*(): Effect.fn.Return<readonly TCanvasRecord[], DatabaseProgramError, DatabaseAuthority> {
  const authority = yield* DatabaseAuthority;
  return yield* authority.listCanvases();
});
