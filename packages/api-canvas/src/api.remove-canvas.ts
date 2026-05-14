import { ORPCError } from '@orpc/contract';
import { baseCanvasOs } from './orpc';

type AutomergeUrl = string & { __documentUrl: true } // for opening / linking

const apiRemoveCanvas = baseCanvasOs.remove.handler(async ({ context, input }) => {
  const result = context.db.canvas.deleteById({ ...input.params, accountId: context.accountId });

  if (result.length === 0) {
    throw new ORPCError('NOT_FOUND', { message: 'Canvas not found' });
  }

  context.automerge.repo.delete(result[0].automerge_url as AutomergeUrl)
  return result[0];
});

export { apiRemoveCanvas };
