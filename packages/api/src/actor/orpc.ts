import { implement } from '@orpc/server';
import { actorsContract } from './contract';
import type { TActorsApiContext } from './types';

const baseActorsOs = implement(actorsContract)
  .$context<TActorsApiContext>();

export { baseActorsOs };
