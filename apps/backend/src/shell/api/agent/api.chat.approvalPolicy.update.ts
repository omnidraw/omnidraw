import { baseAgentOs } from './procedure-builder';

export const apiChatApprovalPolicyUpdate = baseAgentOs.chat.approvalPolicy.update
  .handler(async ({ input, context }) => context.agent.setChatApprovalPolicy(
    input.widgetId,
    input.sessionId,
    input.policy,
  ));
