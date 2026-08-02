import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import type {
  TWidgetPreviewAgentStatus,
  TWidgetPreviewInteractionCheck,
  TWidgetPreviewTestResult,
  TWidgetPreviewWaitResult,
} from '../widget-drafts/types';
import { fnToolError, fnToolSuccess } from './fn.result';
import type { TToolDefinition } from './types';

export type TAgentWidgetPreviewCapability = Readonly<{
  previewStatus(chatId: string, draftId?: string): Promise<TWidgetPreviewAgentStatus>;
  waitForPreview(request: Readonly<{
    chatId: string;
    draftId?: string;
    expectedRevision: string;
    expectedCommittedMutationId: string;
    timeoutMs: number;
    signal?: AbortSignal;
  }>): Promise<TWidgetPreviewWaitResult>;
  testPreview(request: Readonly<{
    chatId: string;
    draftId: string;
    expectedRevision: string;
    expectedCommittedMutationId: string;
    expectedPreviewRevisionId: string;
    checks: readonly TWidgetPreviewInteractionCheck[];
    signal?: AbortSignal;
  }>): Promise<TWidgetPreviewTestResult>;
}>;

type TCreateWidgetPreviewToolsArgs = Readonly<{
  chatId: string;
  preview?: TAgentWidgetPreviewCapability;
  authorize: (
    toolName: 'vc_widget_preview_status' | 'vc_widget_preview_wait' | 'vc_widget_preview_test',
  ) => Promise<boolean>;
}>;

const REVISION = Type.String({ minLength: 64, maxLength: 64 });
const ID = Type.String({ minLength: 1, maxLength: 300 });
const MUTATION_ID = Type.String({ minLength: 1, maxLength: 1_024 });

const STATUS_PARAMETERS = Type.Object({
  draftId: Type.Optional(ID),
}, { additionalProperties: false });

const WAIT_PARAMETERS = Type.Object({
  draftId: Type.Optional(ID),
  expectedRevision: REVISION,
  expectedCommittedMutationId: MUTATION_ID,
  timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 15_000 })),
}, { additionalProperties: false });

const CHECK = Type.Union([
  Type.Object({
    type: Type.Literal('fill'),
    label: Type.String({ minLength: 1, maxLength: 500 }),
    value: Type.String({ maxLength: 2_000 }),
  }, { additionalProperties: false }),
  Type.Object({
    type: Type.Literal('click'),
    name: Type.String({ minLength: 1, maxLength: 500 }),
  }, { additionalProperties: false }),
  Type.Object({
    type: Type.Literal('assert-text'),
    text: Type.String({ minLength: 1, maxLength: 500 }),
  }, { additionalProperties: false }),
  Type.Object({
    type: Type.Literal('assert-status'),
    text: Type.String({ minLength: 1, maxLength: 500 }),
  }, { additionalProperties: false }),
  Type.Object({
    type: Type.Literal('wait-for-text'),
    text: Type.String({ minLength: 1, maxLength: 500 }),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 50, maximum: 5_000 })),
  }, { additionalProperties: false }),
]);

const TEST_PARAMETERS = Type.Object({
  draftId: ID,
  expectedRevision: REVISION,
  expectedCommittedMutationId: MUTATION_ID,
  expectedPreviewRevisionId: ID,
  checks: Type.Array(CHECK, { minItems: 1, maxItems: 12 }),
}, { additionalProperties: false });

function unavailable() {
  return fnToolError({
    code: 'WIDGET_PREVIEW_UNAVAILABLE',
    message: 'Live Preview inspection is unavailable in this host.',
  });
}

function failure(error: unknown) {
  return fnToolError({
    code: error !== null && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'WIDGET_PREVIEW_OPERATION_FAILED',
    message: error instanceof Error ? error.message : String(error),
  });
}

export function createWidgetPreviewTools(
  args: TCreateWidgetPreviewToolsArgs,
): TToolDefinition[] {
  const status = defineTool({
    name: 'vc_widget_preview_status',
    label: 'Preview Status',
    description: 'Inspect bounded authoritative live status for this chat\'s single companion Preview. This exposes revision fences and diagnostics, never DOM, files, credentials, or other Preview owners.',
    parameters: STATUS_PARAMETERS,
    async execute(_toolCallId, params: any) {
      if (!await args.authorize('vc_widget_preview_status')) {
        return fnToolError({ code: 'TOOL_NOT_AUTHORIZED', message: 'This tool call is not authorized.' });
      }
      if (!Check(STATUS_PARAMETERS, params)) {
        return fnToolError({ code: 'WIDGET_PREVIEW_STATUS_INPUT_INVALID', message: 'Preview status accepts only an optional draftId.' });
      }
      if (!args.preview) return unavailable();
      try {
        const result = await args.preview.previewStatus(args.chatId, params.draftId);
        return fnToolSuccess({
          summary: result.message,
          modelData: result,
          details: result,
        });
      } catch (error) {
        return failure(error);
      }
    },
  }) as TToolDefinition;

  const wait = defineTool({
    name: 'vc_widget_preview_wait',
    label: 'Wait for Preview',
    description: 'Wait without polling for the exact committed source revision to become live-ready, fail, be superseded, close, or reach a bounded host timeout. This never creates or publishes canvas state.',
    parameters: WAIT_PARAMETERS,
    async execute(_toolCallId, params: any, signal?: AbortSignal) {
      if (!await args.authorize('vc_widget_preview_wait')) {
        return fnToolError({ code: 'TOOL_NOT_AUTHORIZED', message: 'This tool call is not authorized.' });
      }
      if (!Check(WAIT_PARAMETERS, params)) {
        return fnToolError({ code: 'WIDGET_PREVIEW_WAIT_INPUT_INVALID', message: 'Preview wait requires exact revision and committed mutation identities plus an optional bounded timeout.' });
      }
      if (!args.preview) return unavailable();
      try {
        const result = await args.preview.waitForPreview({
          chatId: args.chatId,
          ...(params.draftId === undefined ? {} : { draftId: params.draftId }),
          expectedRevision: params.expectedRevision,
          expectedCommittedMutationId: params.expectedCommittedMutationId,
          timeoutMs: params.timeoutMs ?? 15_000,
          signal,
        });
        return fnToolSuccess({
          summary: `Exact Preview wait finished with outcome '${result.outcome}': ${result.status.message}`,
          modelData: result,
          details: result,
        });
      } catch (error) {
        return failure(error);
      }
    },
  }) as TToolDefinition;

  const test = defineTool({
    name: 'vc_widget_preview_test',
    label: 'Test Preview',
    description: 'Run up to 12 declared accessible fill, click, visible-text, status, or bounded state-change checks inside the exact authorized live-ready Preview guest root. Arbitrary scripts, selectors, screenshots, and publication are not supported.',
    parameters: TEST_PARAMETERS,
    async execute(_toolCallId, params: any, signal?: AbortSignal) {
      if (!await args.authorize('vc_widget_preview_test')) {
        return fnToolError({ code: 'TOOL_NOT_AUTHORIZED', message: 'This tool call is not authorized.' });
      }
      if (!Check(TEST_PARAMETERS, params)) {
        return fnToolError({ code: 'WIDGET_PREVIEW_TEST_INPUT_INVALID', message: 'Preview test requires exact live revision identities and 1-12 supported declarative checks.' });
      }
      if (!args.preview) return unavailable();
      try {
        const result = await args.preview.testPreview({
          chatId: args.chatId,
          draftId: params.draftId,
          expectedRevision: params.expectedRevision,
          expectedCommittedMutationId: params.expectedCommittedMutationId,
          expectedPreviewRevisionId: params.expectedPreviewRevisionId,
          checks: params.checks,
          signal,
        });
        return fnToolSuccess({
          summary: `Exact Preview interaction test finished with outcome '${result.outcome}'.`,
          modelData: result,
          details: result,
        });
      } catch (error) {
        return failure(error);
      }
    },
  }) as TToolDefinition;

  return [status, wait, test];
}
