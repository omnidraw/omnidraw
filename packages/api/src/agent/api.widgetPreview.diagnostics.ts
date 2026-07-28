import { baseAgentOs } from './orpc';

export const apiWidgetPreviewDiagnosticReport =
  baseAgentOs.widgetPreview.diagnostics.report.handler(
    async ({ input, context }) => context.agent.reportWidgetPreviewDiagnostic(input),
  );

export const apiWidgetPreviewDiagnosticsGet =
  baseAgentOs.widgetPreview.diagnostics.get.handler(
    async ({ input, context }) => context.agent.getWidgetPreviewDiagnostics(input),
  );

export const apiWidgetPreviewDiagnosticRetest =
  baseAgentOs.widgetPreview.diagnostics.retest.handler(
    async ({ input, context }) => context.agent.retestWidgetPreviewDiagnostic(input),
  );

export const apiWidgetPreviewDiagnosticResolve =
  baseAgentOs.widgetPreview.diagnostics.resolve.handler(
    async ({ input, context }) => context.agent.resolveWidgetPreviewDiagnostic(input),
  );
