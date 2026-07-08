import { implement } from '@orpc/server';
import { agentContract } from './contract';
import type { TAgentApiContext } from './types';

const baseAgentOs = implement(agentContract)
  .$context<TAgentApiContext>();

export { baseAgentOs };
