import { ORPCError } from '@orpc/contract';
import { baseCanvasOs } from './orpc';

const apiCreateCanvas = baseCanvasOs.create.handler(async ({ context, input }) => {
  const existingCanvas = await context.db.canvas.findByName(context.tenant, { name: input.name });
  if (existingCanvas)
    throw new ORPCError('ALREADY_EXISTS', { message: 'Canvas already exists' });

  const id = crypto.randomUUID();

  const handle = await context.automerge.createDocument(context.tenant, {
    id,
    elements: {},
    groups: {},
  })

  const canvas = { id: crypto.randomUUID(), name: input.name, automerge_url: handle.url };
  try {
    const result = await context.db.canvas.create(context.tenant, canvas);
    await context.automerge.notifyDocumentRegistered(context.tenant, handle.url);
    return result;
  } catch (error) {
    context.automerge.failDocumentRegistration(context.tenant, handle.url, error);
    throw error;
  }
});

export { apiCreateCanvas };
