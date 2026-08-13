import { implement } from '../procedure';
import { functionContract } from './contract';
import type { TFunctionApiContext } from './types';

const baseFunctionOs = implement(functionContract)
  .$context<TFunctionApiContext>();

export { baseFunctionOs };
