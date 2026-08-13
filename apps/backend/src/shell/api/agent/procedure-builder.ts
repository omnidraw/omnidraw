import { implement } from '../procedure';
import { agentContract } from './contract';
import type { TAgentApiContext } from './types';

const baseAgentOs = implement(agentContract)
  .$context<TAgentApiContext>();

export { baseAgentOs };
