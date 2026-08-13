import { Effect } from 'effect';
import {
  DatabaseAuthority,
  type DatabaseProgramError,
  type TCanvasRecord,
} from './service.database';

export function fxListCanvases(): Effect.Effect<readonly TCanvasRecord[], DatabaseProgramError, DatabaseAuthority> {
  return Effect.gen(function*() {
    const authority = yield* DatabaseAuthority;
    return yield* authority.listCanvases();
  });
}
