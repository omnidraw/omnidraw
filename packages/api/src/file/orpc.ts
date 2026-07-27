import { implement } from '@orpc/server';
import { fileContract } from './contract';
import type { TFileApiContext } from './types';

const baseFileOs = implement(fileContract)
  .$context<TFileApiContext>();

export { baseFileOs };
