import { implement } from '../procedure';
import { canvasContract } from './contract';
import type { TCanvasApiContext } from './types';

const baseCanvasOs = implement(canvasContract)
  .$context<TCanvasApiContext>();

export { baseCanvasOs };
