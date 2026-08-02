import { baseAgentOs } from './orpc';

export const apiUpdateApprovalPolicy = baseAgentOs.settings.approvalPolicy.update
  .handler(async ({ input, context }) => context.agent.updateApprovalPolicy(input));
