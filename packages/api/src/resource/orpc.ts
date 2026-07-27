import { implement } from '@orpc/server';
import { resourceContract } from './contract';
import type { TResourceApiContext } from './types';

const baseResourceOs = implement(resourceContract)
  .$context<TResourceApiContext>();

export { baseResourceOs };
