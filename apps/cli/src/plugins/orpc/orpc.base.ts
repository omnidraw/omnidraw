import { implement, onError } from '@orpc/server';
import { apiContract, contract } from '@vibecanvas/api/contract';
import type { TApiContext } from '@vibecanvas/api/context';

const baseOs = implement(apiContract)
  .$context<TApiContext>()
  .use(onError((error) => {
    console.error(error);
  }));

export { apiContract, baseOs, contract };
