import type { TWidgetAuthoringDraftSelector } from '../../core/widget-authoring/interface';
import type {
  TWidgetPreviewInspectInput,
  TWidgetPreviewInspectResult,
  TWidgetPreviewInspectionToolError,
} from '../agent';

export type TWidgetAuthoringDiagnostic = Readonly<{
  code: string;
  message: string;
  path: string | null;
}>;

export type TWidgetAuthoringResolvedDraft = Readonly<{
  catalogGeneration: number;
  catalogDigestSha256: string;
  widgetKey: string;
  displayName: string;
  health: 'healthy';
  draftDigestSha256: string;
  draftPath: string;
}>;

export type TWidgetAuthoringValidationResult = Readonly<{
  ok: boolean;
  widgetKey: string;
  displayName: string;
  selectedCatalogGeneration: number;
  selectedCatalogDigestSha256: string;
  capturedDraftDigestSha256: string;
  executableInputDigestSha256: string | null;
  acceptedGeneration: number | null;
  buildIdentity: string | null;
  sourceValidation: Readonly<{
    status: 'passed' | 'failed';
    diagnostics: readonly TWidgetAuthoringDiagnostic[];
    files: readonly string[];
    filesTruncated: boolean;
  }>;
  acceptedArtifactBuild: Readonly<{
    status: 'passed' | 'failed' | 'not_run';
    diagnostics: readonly TWidgetAuthoringDiagnostic[];
  }>;
  livePreviewRuntime: 'not_exercised';
  resources: 'not_exercised';
}>;

export type TWidgetAuthoringInspectRequest = Readonly<{
  widgetKey: string;
  expectedDraftDigestSha256: string;
  expectedAcceptedGeneration: number;
  expectedBuildIdentity: string;
  mode: 'artifact' | 'preview';
  canvasId?: string;
  viewport?: TWidgetPreviewInspectInput['viewport'];
  settle?: TWidgetPreviewInspectInput['settle'];
  actions?: TWidgetPreviewInspectInput['actions'];
  continueOnActionError?: boolean;
  timeoutMs?: number;
  includeScreenshot: boolean;
  operationId: string;
  signal?: AbortSignal;
}>;

export type TWidgetAuthoringInspectionResult = Readonly<{
  ok: boolean;
  widgetKey: string;
  draftDigestSha256: string;
  acceptedGeneration: number;
  buildIdentity: string;
  canvasCorrelation: Readonly<{
    canvas: 'not_selected' | 'selected';
    visibleFrame: 'not_claimed';
  }>;
  result?: TWidgetPreviewInspectResult;
  error?: TWidgetPreviewInspectionToolError;
  screenshotLease?: Readonly<{
    url: string;
    expiresAtMs: number;
  }>;
}>;

export interface IWidgetAuthoringVerification {
  resolve(
    selector: TWidgetAuthoringDraftSelector,
    signal?: AbortSignal,
  ): Promise<TWidgetAuthoringResolvedDraft>;
  validate(args: Readonly<{
    widgetKey: string;
    expectedDraftDigestSha256?: string;
    signal?: AbortSignal;
  }>): Promise<TWidgetAuthoringValidationResult>;
  inspect(args: TWidgetAuthoringInspectRequest): Promise<TWidgetAuthoringInspectionResult>;
}
