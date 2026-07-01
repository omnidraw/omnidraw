import { implement } from '@orpc/server';
import { agentContract } from './contract';
import type { TActorsApiContext } from './types';

const baseActorsOs = implement(agentContract)
  .$context<TActorsApiContext>();

export { baseActorsOs };
