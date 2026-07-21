import { implement } from '@orpc/server';
import { dbContract } from './contract';
import type { TDbApiContext } from './types';

const baseDbOs = implement(dbContract)
  .$context<TDbApiContext>();

export { baseDbOs };
