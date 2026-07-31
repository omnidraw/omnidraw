import { implement, type Implementer } from '@orpc/server';
import { apiContract, contract } from '@omnidraw/api/contract';
import type { TApiContext } from '@omnidraw/api/context';

const baseOs: Implementer<typeof apiContract, TApiContext, TApiContext> = implement(apiContract)
  .$context<TApiContext>();

export { apiContract, baseOs, contract };
