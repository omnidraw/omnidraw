import { implement } from '../procedure';
import { fileContract } from './contract';
import type { TFileApiContext } from './types';

const baseFileOs = implement(fileContract)
  .$context<TFileApiContext>();

export { baseFileOs };
