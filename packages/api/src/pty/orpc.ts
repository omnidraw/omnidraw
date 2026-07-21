import { implement } from '@orpc/server';
import { ptyContract } from './contract';
import type { TPtyApiContext } from './types';

const basePtyOs = implement(ptyContract)
  .$context<TPtyApiContext>();

export { basePtyOs };
