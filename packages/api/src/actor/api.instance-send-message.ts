import { baseActorsOs } from './orpc';

const apiActorSendMessage = baseActorsOs.instances.sendMessage.handler(async ({ input, context }) => {
  const messageId = await context.actor.sendMessage(input.instanceId, input.name, input.payload);
  return { messageId };
});

export { apiActorSendMessage };
