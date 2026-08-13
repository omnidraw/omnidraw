import { defineTool } from '@earendil-works/pi-coding-agent';
import { fnValidateBoundedPngBytes } from '#backend/core/shared/image/fn.png-base64';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import type { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import {
  fnNormalizeWidgetPreviewInspectInput,
  fnValidateWidgetPreviewInspectProtocol,
} from './fn.widget-preview-inspect';
import { fnToolError, fnToolSuccess, fnToolSuccessWithPng } from './fn.result';
import type {
  TToolDefinition,
  TWidgetPreviewInspectResult,
  TWidgetPreviewInspectionCapability,
} from './types';

type TCreateWidgetPreviewInspectToolArgs = Readonly<{
  workspace: WidgetWorkspace;
  chatId: string;
  authorize: () => Promise<boolean>;
  capability?: TWidgetPreviewInspectionCapability;
  resolvePreviewScope?(name: string): Promise<Readonly<{
    canvasId: string;
    aiChatElementId: string;
  }> | null>;
}>;

const SHA256_SCHEMA = Type.String({ pattern: '^[a-f0-9]{64}$' });
const NON_NEGATIVE_INTEGER_SCHEMA = Type.Integer({ minimum: 0 });
const BOUNDS_SCHEMA = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
  width: Type.Number({ minimum: 0 }),
  height: Type.Number({ minimum: 0 }),
}, { additionalProperties: false });

const TARGET_SCHEMA = Type.Union([
  Type.Object({
    by: Type.Literal('css'),
    selector: Type.String({ minLength: 1, maxLength: 512 }),
  }, { additionalProperties: false }),
  Type.Object({
    by: Type.Literal('role'),
    role: Type.Union([
      Type.Literal('button'),
      Type.Literal('checkbox'),
      Type.Literal('combobox'),
      Type.Literal('link'),
      Type.Literal('listbox'),
      Type.Literal('menuitem'),
      Type.Literal('option'),
      Type.Literal('radio'),
      Type.Literal('slider'),
      Type.Literal('spinbutton'),
      Type.Literal('switch'),
      Type.Literal('tab'),
      Type.Literal('textbox'),
    ]),
    name: Type.Optional(Type.String({ maxLength: 256 })),
    exact: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false }),
  Type.Object({
    by: Type.Literal('label'),
    text: Type.String({ minLength: 1, maxLength: 256 }),
    exact: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false }),
]);

const ACTION_SCHEMA = Type.Union([
  Type.Object({
    type: Type.Literal('click'),
    target: TARGET_SCHEMA,
  }, { additionalProperties: false }),
  Type.Object({
    type: Type.Literal('input'),
    target: TARGET_SCHEMA,
    value: Type.String({ maxLength: 4_096 }),
    commit: Type.Optional(Type.Union([
      Type.Literal('none'),
      Type.Literal('blur'),
      Type.Literal('enter'),
    ])),
  }, { additionalProperties: false }),
  Type.Object({
    type: Type.Literal('waitFrames'),
    count: Type.Integer({ minimum: 1, maximum: 120 }),
  }, { additionalProperties: false }),
  Type.Object({
    type: Type.Literal('assertText'),
    target: TARGET_SCHEMA,
    text: Type.String({ minLength: 1, maxLength: 512 }),
    exact: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false }),
]);

const WIDGET_PREVIEW_INSPECT_PARAMETERS = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  mode: Type.Optional(Type.Union([Type.Literal('artifact'), Type.Literal('preview')])),
  expectedDraftDigestSha256: Type.Optional(SHA256_SCHEMA),
  expectedAcceptedGeneration: Type.Optional(Type.Integer({ minimum: 1 })),
  viewport: Type.Optional(Type.Object({
    width: Type.Optional(Type.Integer({ minimum: 160, maximum: 1_280 })),
    height: Type.Optional(Type.Integer({ minimum: 120, maximum: 1_024 })),
    deviceScaleFactor: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(2)])),
  }, { additionalProperties: false })),
  settle: Type.Optional(Type.Object({
    frames: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 10_000 })),
  }, { additionalProperties: false })),
  actions: Type.Optional(Type.Array(ACTION_SCHEMA, { maxItems: 16 })),
  continueOnActionError: Type.Optional(Type.Boolean()),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 180_000 })),
}, { additionalProperties: false });

const IDENTITY_SCHEMA = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  widgetKey: Type.String({ minLength: 1, maxLength: 100, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
  draftDigestSha256: SHA256_SCHEMA,
  executableInputDigestSha256: SHA256_SCHEMA,
  environmentIdentity: Type.String({ minLength: 1, maxLength: 2_000 }),
}, { additionalProperties: false });

const ARTIFACT_SCHEMA = Type.Object({
  artifactDigestSha256: SHA256_SCHEMA,
  artifactHash: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
  constructionReused: Type.Boolean(),
}, { additionalProperties: false });

const SCREENSHOT_SCHEMA = Type.Object({
  mimeType: Type.Literal('image/png'),
  width: Type.Integer({ minimum: 1, maximum: 2_560 }),
  height: Type.Integer({ minimum: 1, maximum: 2_048 }),
  byteSize: Type.Integer({ minimum: 1, maximum: 8 * 1_024 * 1_024 }),
  digestSha256: SHA256_SCHEMA,
}, { additionalProperties: false });

const FIDELITY_SCHEMA = Type.Union([
  Type.Object({
    source: Type.Literal('exact'),
    artifact: Type.Literal('exact'),
    runtimePolicy: Type.Literal('narrowed'),
    bindings: Type.Literal('unavailable'),
    network: Type.Literal('denied'),
    overall: Type.Literal('artifact_exact'),
  }, { additionalProperties: false }),
  Type.Object({
    source: Type.Literal('exact'),
    artifact: Type.Literal('exact'),
    runtimePolicy: Type.Literal('preview'),
    bindings: Type.Literal('manifest'),
    network: Type.Literal('denied'),
    overall: Type.Literal('preview_policy_exact'),
  }, { additionalProperties: false }),
]);

const VERIFICATION_SCHEMA = Type.Object({
  surface: Type.Union([Type.Literal('artifact'), Type.Literal('preview')]),
  generation: Type.Literal('current'),
  artifact: Type.Literal('exact'),
  manifest: Type.Literal('exact'),
  resources: Type.Union([Type.Literal('not_available'), Type.Literal('manifest_bound')]),
  canvasParity: Type.Union([Type.Literal('not_claimed'), Type.Literal('same_runtime_policy')]),
  visibleFrame: Type.Literal('not_claimed'),
  executionTarget: Type.Literal('diagnostic_clone'),
  previewState: Type.Union([
    Type.Literal('not_applicable'),
    Type.Literal('absent'),
    Type.Literal('mounting'),
    Type.Literal('failed'),
    Type.Literal('ready'),
    Type.Literal('retired'),
    Type.Literal('ambiguous'),
    Type.Literal('generation_mismatch'),
  ]),
  nextAction: Type.Union([
    Type.Literal('none'),
    Type.Literal('repair_visible_preview'),
    Type.Literal('retry_after_settle'),
    Type.Literal('reopen_preview'),
    Type.Literal('remove_duplicate_previews'),
    Type.Literal('retry_current_generation'),
    Type.Literal('use_preview_mode_for_resources'),
  ]),
  functional: Type.Union([
    Type.Literal('observed'),
    Type.Literal('not_exercised'),
    Type.Literal('not_verified_missing_reference'),
    Type.Literal('blocked_write_approval'),
    Type.Literal('failed'),
  ]),
}, { additionalProperties: false });

const ACTION_RESULT_SCHEMA = Type.Object({
  index: NON_NEGATIVE_INTEGER_SCHEMA,
  type: Type.Union([Type.Literal('assertText'), Type.Literal('click'), Type.Literal('input'), Type.Literal('waitFrames')]),
  status: Type.Union([
    Type.Literal('passed'),
    Type.Literal('no_match'),
    Type.Literal('ambiguous'),
    Type.Literal('not_visible'),
    Type.Literal('occluded'),
    Type.Literal('disabled'),
    Type.Literal('unsupported'),
    Type.Literal('failed'),
    Type.Literal('skipped'),
  ]),
  matchedCount: NON_NEGATIVE_INTEGER_SCHEMA,
  message: Type.String({ maxLength: 2_000 }),
  target: Type.Optional(Type.Object({
    id: NON_NEGATIVE_INTEGER_SCHEMA,
    tag: Type.String({ minLength: 1, maxLength: 128 }),
    role: Type.Optional(Type.String({ maxLength: 128 })),
    name: Type.Optional(Type.String({ maxLength: 512 })),
    bounds: BOUNDS_SCHEMA,
  }, { additionalProperties: false })),
}, { additionalProperties: false });

const DIAGNOSTIC_SCHEMA = Type.Object({
  fingerprint: Type.String({ minLength: 1, maxLength: 256 }),
  origin: Type.Union([
    Type.Literal('source'),
    Type.Literal('install'),
    Type.Literal('build'),
    Type.Literal('capsule'),
    Type.Literal('host'),
    Type.Literal('guest'),
    Type.Literal('capability'),
    Type.Literal('channel'),
    Type.Literal('budget'),
    Type.Literal('lifecycle'),
  ]),
  phase: Type.String({ maxLength: 256 }),
  code: Type.String({ minLength: 1, maxLength: 256 }),
  severity: Type.Union([Type.Literal('error'), Type.Literal('warning'), Type.Literal('info')]),
  message: Type.String({ maxLength: 2_000 }),
  trust: Type.Union([Type.Literal('trusted'), Type.Literal('untrusted')]),
  retryability: Type.Union([
    Type.Literal('retryable'),
    Type.Literal('non-retryable'),
    Type.Literal('unknown'),
  ]),
  occurrenceCount: Type.Integer({ minimum: 1 }),
  location: Type.Optional(Type.Object({
    file: Type.String({
      minLength: 10,
      maxLength: 509,
      pattern: '^widget://(?!(?:\\.{1,2})(?:/|$))[A-Za-z0-9@_+.,=~\\-]+(?:/(?!(?:\\.{1,2})(?:/|$))[A-Za-z0-9@_+.,=~\\-]+)*$',
    }),
    line: Type.Optional(Type.Integer({ minimum: 1 })),
    column: Type.Optional(Type.Integer({ minimum: 1 })),
  }, { additionalProperties: false })),
  capability: Type.Optional(Type.String({ maxLength: 256 })),
  operation: Type.Optional(Type.String({ maxLength: 256 })),
}, { additionalProperties: false });

const WIDGET_PREVIEW_INSPECTION_TOOL_ERROR_SCHEMA = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Z][A-Z0-9_]*$' }),
  message: Type.String({ maxLength: 2_000 }),
  retryable: Type.Boolean(),
  observedDraftDigestSha256: Type.Optional(SHA256_SCHEMA),
  previewState: Type.Optional(VERIFICATION_SCHEMA.properties.previewState),
  nextAction: Type.Optional(VERIFICATION_SCHEMA.properties.nextAction),
  diagnostics: Type.Optional(Type.Array(DIAGNOSTIC_SCHEMA, { maxItems: 20 })),
}, { additionalProperties: false });

const ELEMENT_SCHEMA = Type.Object({
  id: NON_NEGATIVE_INTEGER_SCHEMA,
  tag: Type.String({ minLength: 1, maxLength: 128 }),
  role: Type.Optional(Type.String({ maxLength: 128 })),
  name: Type.Optional(Type.String({ maxLength: 512 })),
  text: Type.Optional(Type.String({ maxLength: 512 })),
  bounds: BOUNDS_SCHEMA,
  state: Type.Optional(Type.Object({
    checked: Type.Optional(Type.Boolean()),
    disabled: Type.Optional(Type.Boolean()),
    expanded: Type.Optional(Type.Boolean()),
    selected: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false })),
  computed: Type.Object({
    display: Type.String({ maxLength: 128 }),
    visibility: Type.String({ maxLength: 128 }),
    opacity: Type.String({ maxLength: 128 }),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

const CANVAS_SCHEMA = Type.Object({
  id: NON_NEGATIVE_INTEGER_SCHEMA,
  bounds: BOUNDS_SCHEMA,
  width: NON_NEGATIVE_INTEGER_SCHEMA,
  height: NON_NEGATIVE_INTEGER_SCHEMA,
  context: Type.Union([
    Type.Literal('2d'),
    Type.Literal('webgl'),
    Type.Literal('webgl2'),
    Type.Literal('webgpu'),
    Type.Literal('unknown'),
  ]),
}, { additionalProperties: false });

const PAGE_EVIDENCE_SCHEMA = Type.Object({
  width: Type.Integer({ minimum: 160, maximum: 1_280 }),
  height: Type.Integer({ minimum: 120, maximum: 1_024 }),
  deviceScaleFactor: Type.Union([Type.Literal(1), Type.Literal(2)]),
}, { additionalProperties: false });
const DIAGNOSTICS_EVIDENCE_SCHEMA = Type.Object({
  entries: Type.Array(DIAGNOSTIC_SCHEMA, { maxItems: 100 }),
  droppedCount: NON_NEGATIVE_INTEGER_SCHEMA,
  truncated: Type.Boolean(),
}, { additionalProperties: false });
const ELEMENTS_EVIDENCE_SCHEMA = Type.Object({
  entries: Type.Array(ELEMENT_SCHEMA, { maxItems: 128 }),
  scannedCount: Type.Integer({ minimum: 0, maximum: 4_096 }),
  omittedCount: NON_NEGATIVE_INTEGER_SCHEMA,
  truncated: Type.Boolean(),
}, { additionalProperties: false });
const CANVASES_EVIDENCE_SCHEMA = Type.Object({
  entries: Type.Array(CANVAS_SCHEMA, { maxItems: 16 }),
  omittedCount: NON_NEGATIVE_INTEGER_SCHEMA,
  truncated: Type.Boolean(),
}, { additionalProperties: false });
const EVIDENCE_SCHEMA = Type.Object({
  page: PAGE_EVIDENCE_SCHEMA,
  actions: Type.Array(ACTION_RESULT_SCHEMA, { maxItems: 16 }),
  diagnostics: DIAGNOSTICS_EVIDENCE_SCHEMA,
  elements: ELEMENTS_EVIDENCE_SCHEMA,
  canvases: CANVASES_EVIDENCE_SCHEMA,
}, { additionalProperties: false });
const PARTIAL_EVIDENCE_SCHEMA = Type.Object({
  page: Type.Optional(PAGE_EVIDENCE_SCHEMA),
  actions: Type.Optional(Type.Array(ACTION_RESULT_SCHEMA, { maxItems: 16 })),
  diagnostics: Type.Optional(DIAGNOSTICS_EVIDENCE_SCHEMA),
  elements: Type.Optional(ELEMENTS_EVIDENCE_SCHEMA),
  canvases: Type.Optional(CANVASES_EVIDENCE_SCHEMA),
}, { additionalProperties: false });

const STAGE_SCHEMA = Type.Union([
  Type.Literal('scope'),
  Type.Literal('build'),
  Type.Literal('sign'),
  Type.Literal('mount'),
  Type.Literal('actions'),
  Type.Literal('settle'),
  Type.Literal('capture_screenshot'),
]);
const FAILURE_SCHEMA = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 256 }),
  message: Type.String({ maxLength: 2_000 }),
  retryable: Type.Boolean(),
}, { additionalProperties: false });

const WIDGET_PREVIEW_INSPECT_RESULT_SCHEMA = Type.Union([
  Type.Object({
    status: Type.Union([Type.Literal('completed'), Type.Literal('completed_with_errors')]),
    identity: IDENTITY_SCHEMA,
    artifact: ARTIFACT_SCHEMA,
    fidelity: FIDELITY_SCHEMA,
    verification: VERIFICATION_SCHEMA,
    screenshot: SCREENSHOT_SCHEMA,
    evidence: EVIDENCE_SCHEMA,
    durationMs: Type.Number({ minimum: 0 }),
  }, { additionalProperties: false }),
  Type.Object({
    status: Type.Literal('failed'),
    stage: STAGE_SCHEMA,
    failure: FAILURE_SCHEMA,
    identity: IDENTITY_SCHEMA,
    verification: VERIFICATION_SCHEMA,
    artifact: Type.Optional(ARTIFACT_SCHEMA),
    screenshot: Type.Optional(SCREENSHOT_SCHEMA),
    evidence: Type.Optional(PARTIAL_EVIDENCE_SCHEMA),
    durationMs: Type.Number({ minimum: 0 }),
  }, { additionalProperties: false }),
  Type.Object({
    status: Type.Union([Type.Literal('timed_out'), Type.Literal('cancelled')]),
    stage: STAGE_SCHEMA,
    failure: FAILURE_SCHEMA,
    identity: IDENTITY_SCHEMA,
    verification: VERIFICATION_SCHEMA,
    artifact: Type.Optional(ARTIFACT_SCHEMA),
    screenshot: Type.Optional(SCREENSHOT_SCHEMA),
    durationMs: Type.Number({ minimum: 0 }),
  }, { additionalProperties: false }),
]);

function protocolError(message: string) {
  return fnToolError({
    code: 'WIDGET_PREVIEW_INSPECT_PROTOCOL_INVALID',
    message,
  });
}

function awaitInspectionOperation<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('Preview inspection was aborted.'));
  return new Promise<T>((resolve, reject) => {
    let abortTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = (): void => {
      abortTimer = setTimeout(
        () => reject(new Error('Preview inspection was aborted.')),
        0,
      );
    };
    signal.addEventListener('abort', abort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        if (abortTimer !== undefined) clearTimeout(abortTimer);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        if (abortTimer !== undefined) clearTimeout(abortTimer);
        reject(error);
      },
    );
  });
}

export function createWidgetPreviewInspectTool(args: TCreateWidgetPreviewInspectToolArgs): TToolDefinition {
  return defineTool({
    name: 'od_widget_preview_inspect',
    label: 'Inspect Widget Preview',
    description: 'Inspect one host-accepted widget generation with up to 16 bounded actions and one widget-only PNG. mode "artifact" is isolated, cannot exercise resources, and claims no Preview parity. mode "preview" requires the active verified widget target and runs the exact accepted generation with manifest-bound runtime policy in a diagnostic clone even when its visible frame is absent or failed; writes remain approval-blocked. The tool never builds, publishes, or mutates canvas layout.',
    parameters: WIDGET_PREVIEW_INSPECT_PARAMETERS,
    async execute(toolCallId: string, params: unknown, signal?: AbortSignal) {
      const normalized = fnNormalizeWidgetPreviewInspectInput(params);
      if (!normalized.ok || !Check(WIDGET_PREVIEW_INSPECT_PARAMETERS, params)) {
        return fnToolError({
          code: 'WIDGET_PREVIEW_INSPECT_INPUT_INVALID',
          message: normalized.ok
            ? 'Widget Preview inspection input is invalid.'
            : normalized.message,
        });
      }

      const operationController = new AbortController();
      let timedOut = false;
      const abortFromCaller = () => operationController.abort('caller-cancelled');
      if (signal?.aborted) abortFromCaller();
      else signal?.addEventListener('abort', abortFromCaller, { once: true });
      const timeout = setTimeout(() => {
        if (operationController.signal.aborted) return;
        timedOut = true;
        operationController.abort('inspection-timeout');
      }, normalized.value.timeoutMs);
      const abortedResult = () => fnToolError({
        code: timedOut
          ? 'WIDGET_PREVIEW_INSPECT_TIMED_OUT'
          : 'WIDGET_PREVIEW_INSPECT_CANCELLED',
        message: timedOut
          ? 'Widget Preview inspection exceeded its whole-call timeout before a result became available.'
          : 'Widget Preview inspection was cancelled before a result became available.',
      });

      try {
      if (operationController.signal.aborted) return abortedResult();
      let authorized: boolean;
      try {
        authorized = await awaitInspectionOperation(
          args.authorize(),
          operationController.signal,
        );
      } catch {
        if (operationController.signal.aborted) return abortedResult();
        return fnToolError({
          code: 'TOOL_AUTHORIZATION_FAILED',
          message: 'This tool call could not be authorized.',
        });
      }
      if (operationController.signal.aborted) return abortedResult();
      if (!authorized) {
        return fnToolError({ code: 'TOOL_NOT_AUTHORIZED', message: 'This tool call is not authorized.' });
      }
      if (!args.capability) {
        return fnToolError({
          code: 'WIDGET_PREVIEW_INSPECTION_UNAVAILABLE',
          message: 'Widget Preview inspection is unavailable because this host did not provide the isolated inspection capability.',
        });
      }
      let mount;
      try {
        mount = await awaitInspectionOperation(
          args.workspace.findMountedWidget(args.chatId, normalized.value.name),
          operationController.signal,
        );
      } catch {
        if (operationController.signal.aborted) return abortedResult();
        return fnToolError({
          code: 'WIDGET_PREVIEW_INSPECT_DRAFT_UNAVAILABLE',
          message: 'The requested widget is not a safe mounted draft in this chat.',
        });
      }

      const queuedMount = mount;
      try {
        return await args.workspace.withDraftAuthoringOperation(mount.name, async () => {
          if (operationController.signal.aborted) return abortedResult();
          try {
            mount = await awaitInspectionOperation(
              args.workspace.findMountedWidget(
                args.chatId,
                queuedMount.name,
              ),
              operationController.signal,
            );
          } catch {
            return fnToolError({
              code: 'WIDGET_PREVIEW_INSPECT_DRAFT_UNAVAILABLE',
              message: 'The mounted widget draft became unavailable before inspection could start.',
            });
          }
          if (mount.targetPath !== queuedMount.targetPath) {
            return fnToolError({
              code: 'WIDGET_PREVIEW_INSPECT_DRAFT_UNAVAILABLE',
              message: 'The mounted widget draft changed before inspection could start.',
              retryable: true,
            });
          }
          if (operationController.signal.aborted) return abortedResult();
          const widgetKey = basename(mount.targetPath);
          const input = Object.freeze({ ...normalized.value, name: mount.name });
          let scope;
          if (input.mode === 'preview') {
            try {
              scope = await awaitInspectionOperation(
                args.resolvePreviewScope?.(mount.name) ?? Promise.resolve(null),
                operationController.signal,
              );
            } catch {
              scope = null;
            }
            if (scope === null) {
              return fnToolError({
                code: 'PREVIEW_SCOPE_UNAVAILABLE',
                message: 'Preview mode requires this widget to be the active verified target on the current chat canvas.',
                retryable: true,
              });
            }
          }
          let response;
          try {
            response = await awaitInspectionOperation(
              args.capability!.inspect(Object.freeze({
                chatId: args.chatId,
                toolCallId,
                name: mount.name,
                widgetKey,
                input,
                ...(scope === undefined ? {} : { scope }),
                signal: operationController.signal,
              })),
              operationController.signal,
            );
          } catch {
            if (operationController.signal.aborted) return abortedResult();
            return fnToolError({
              code: 'WIDGET_PREVIEW_INSPECT_FAILED',
              message: 'Widget Preview inspection failed before a safe result became available.',
            });
          }

          if (
            typeof response !== 'object'
            || response === null
            || Array.isArray(response)
          ) {
            return protocolError('The host returned an invalid Widget Preview inspection result.');
          }
          if (operationController.signal.aborted) {
            const status = 'result' in response
              && typeof response.result === 'object'
              && response.result !== null
              && 'status' in response.result
              ? response.result.status
              : undefined;
            const expectedTerminalStatus = timedOut ? 'timed_out' : 'cancelled';
            if (status !== expectedTerminalStatus) return abortedResult();
          }
          if ('toolError' in response) {
            if (Object.keys(response).length !== 1 || !Check(WIDGET_PREVIEW_INSPECTION_TOOL_ERROR_SCHEMA, response.toolError)) {
              return protocolError('The host returned an invalid Widget Preview inspection boundary error.');
            }
            return fnToolError({
              code: response.toolError.code,
              message: response.toolError.message,
              retryable: response.toolError.retryable,
              ...(response.toolError.observedDraftDigestSha256 === undefined
                && response.toolError.previewState === undefined
                && response.toolError.nextAction === undefined
                && response.toolError.diagnostics === undefined
                ? {}
                : {
                    modelData: {
                      ...(response.toolError.observedDraftDigestSha256 === undefined
                        ? {}
                        : { observedDraftDigestSha256: response.toolError.observedDraftDigestSha256 }),
                      ...(response.toolError.previewState === undefined
                        ? {}
                        : { previewState: response.toolError.previewState }),
                      ...(response.toolError.nextAction === undefined
                        ? {}
                        : { nextAction: response.toolError.nextAction }),
                      ...(response.toolError.diagnostics === undefined
                        ? {}
                        : { diagnostics: response.toolError.diagnostics }),
                    },
                  }),
            });
          }
          if (
            !('result' in response)
            || Object.keys(response).some((key) => key !== 'result' && key !== 'screenshotPng')
            || !Check(WIDGET_PREVIEW_INSPECT_RESULT_SCHEMA, response.result)
          ) {
            return protocolError('The host returned an invalid Widget Preview inspection result.');
          }

          const result = response.result as TWidgetPreviewInspectResult;
          const screenshotPng = 'screenshotPng' in response ? response.screenshotPng : undefined;
          if (screenshotPng !== undefined && !(screenshotPng instanceof Uint8Array)) {
            return protocolError('The host returned invalid Widget Preview screenshot bytes.');
          }

          let observedPng;
          let base64: string | undefined;
          if (screenshotPng !== undefined) {
            const png = Buffer.from(screenshotPng);
            const validation = fnValidateBoundedPngBytes(png);
            if (!validation.ok) {
              return protocolError('The host returned malformed or oversized Widget Preview PNG bytes.');
            }
            observedPng = Object.freeze({
              byteSize: validation.metadata.byteSize,
              digestSha256: createHash('sha256').update(png).digest('hex'),
              width: validation.metadata.width,
              height: validation.metadata.height,
            });
            base64 = png.toString('base64');
          }

          const protocol = fnValidateWidgetPreviewInspectProtocol({
            result,
            expectedName: mount.name,
            expectedWidgetKey: widgetKey,
            input,
            ...(observedPng === undefined ? {} : { observedPng }),
          });
          if (!protocol.ok) return protocolError(protocol.message);

          const surface = result.verification.surface === 'preview'
            ? 'manifest-bound Preview diagnostic clone'
            : 'isolated artifact';
          const summary = result.status === 'completed'
            ? `Widget '${mount.name}' ${surface} completed with functional evidence: ${result.verification.functional}. Visible-frame pixel parity was not claimed.`
            : result.status === 'completed_with_errors'
              ? `Widget '${mount.name}' ${surface} completed with blocking evidence: ${result.verification.functional}. Visible-frame pixel parity was not claimed.`
              : `Widget '${mount.name}' ${surface} ended with status ${result.status} during ${result.stage}; functional verification failed.`;
          if (base64 === undefined) {
            return fnToolSuccess({ summary, modelData: result, details: result });
          }
          try {
            return fnToolSuccessWithPng({
              summary,
              modelData: result,
              details: result,
              image: { mimeType: 'image/png', data: base64 },
            });
          } catch {
            return protocolError('The host returned Widget Preview PNG bytes that could not be transported safely.');
          }
        }, { signal: operationController.signal });
      } catch {
        if (operationController.signal.aborted) return abortedResult();
        return fnToolError({
          code: 'WIDGET_PREVIEW_INSPECT_DRAFT_UNAVAILABLE',
          message: 'The mounted widget draft became unavailable before inspection could start.',
        });
      }
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abortFromCaller);
      }
    },
  }) as TToolDefinition;
}
