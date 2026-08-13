import { baseAgentOs } from './procedure-builder';

export const apiUpdateApprovalPolicy = baseAgentOs.settings.approvalPolicy.update
  .handler(async ({ input, context }) => context.agent.updateApprovalPolicy(input));
