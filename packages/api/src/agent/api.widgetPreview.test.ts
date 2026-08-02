import { baseAgentOs } from './orpc';

export const apiWidgetPreviewTestReport =
  baseAgentOs.widgetPreview.test.report.handler(
    async ({ input, context }) => ({
      accepted: await context.agent.reportWidgetPreviewTestResult(input),
    }),
  );
