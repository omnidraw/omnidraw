import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { TOfflineCheckDiagnostic, TOfflineCheckReport } from '@omnidraw/sdk/fn.offline-check';
import { fnResolveWidgetAuthoringDraft } from '../../core/widget-authoring/fn.resolve-draft';
import type {
  TWidgetAuthoringCatalog,
  TWidgetAuthoringDraftSelector,
} from '../../core/widget-authoring/interface';
import { fnLintRequiredWidgetFiles } from '../../core/agent/lint/fn.required-widget-files';
import { fnValidateManifest } from '../../core/agent/lint/fn.validate-manifest';
import type {
  NodeWidgetFilesystemWorkspace,
  TWidgetCatalogSnapshot,
} from '../agent';
import {
  fnNormalizeWidgetPreviewInspectInput,
  fnValidateWidgetPreviewInspectProtocol,
} from '../agent/tools/fn.widget-preview-inspect';
import type { WidgetFilesystemRuntimeCatalog } from '../widget/WidgetFilesystemRuntimeCatalog';
import type { WidgetBuildGenerationService } from '../widget/WidgetBuildGenerationService';
import type { WidgetPreviewService } from '../widget/WidgetPreviewService';
import type {
  IWidgetAuthoringVerification,
  TWidgetAuthoringDiagnostic,
  TWidgetAuthoringInspectionResult,
  TWidgetAuthoringResolvedDraft,
  TWidgetAuthoringValidationResult,
} from './interface';
import type { WidgetScreenshotLeaseService } from './WidgetScreenshotLeaseService';

const MAX_SOURCE_DIAGNOSTICS = 40;
const MAX_SOURCE_FILES = 100;

function authoringError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function assertAuthoringActive(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw authoringError('ABORT_ERR', 'Widget authoring verification was cancelled.');
}

function safeDiagnosticMessage(value: string): string {
  return value
    .replace(
      /(?:file:\/\/)?(?:[A-Za-z]:)?[\\/](?:Users|home|private|tmp|var)[\\/][^\s'"]+/gi,
      'widget://project',
    )
    .replace(/(?:postgres|mysql|libsql|https?):\/\/[^\s]+/gi, '[redacted]')
    .replace(/\b(token|secret|password|credential)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, 2_000);
}

function safeDiagnosticPath(value: string | null): string | null {
  if (
    value === null
    || value.length > 512
    || value.startsWith('/')
    || value.startsWith('\\')
    || /^[A-Za-z]:\//.test(value)
    || value.includes('\\')
    || value.split('/').some((segment) => segment === '..' || segment === '')
  ) return null;
  return value.replace(/[\u0000-\u001f\u007f]/g, '');
}

function safeDiagnostic(error: unknown): TWidgetAuthoringDiagnostic {
  const rawCode = error !== null && typeof error === 'object' && 'code' in error
    ? error.code
    : undefined;
  const rawMessage = error instanceof Error ? error.message : String(error);
  return Object.freeze({
    code: typeof rawCode === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(rawCode)
      ? rawCode
      : 'WIDGET_BUILD_FAILED',
    message: safeDiagnosticMessage(rawMessage),
    path: null,
  });
}

function offlineDiagnosticPath(value: string): string | null {
  if (!value.startsWith('widget://')) return null;
  const relative = value.slice('widget://'.length);
  return relative === '.' ? null : safeDiagnosticPath(relative);
}

function offlineDiagnostic(diagnostic: TOfflineCheckDiagnostic): TWidgetAuthoringDiagnostic {
  const position = diagnostic.location.line === undefined
    ? ''
    : diagnostic.location.column === undefined
      ? `Line ${diagnostic.location.line}: `
      : `Line ${diagnostic.location.line}, column ${diagnostic.location.column}: `;
  return Object.freeze({
    code: /^[A-Z][A-Z0-9_]{0,127}$/.test(diagnostic.code)
      ? diagnostic.code
      : 'SOURCE_VALIDATION_FAILED',
    message: safeDiagnosticMessage(`${position}${diagnostic.summary}`),
    path: offlineDiagnosticPath(diagnostic.location.file),
  });
}

function catalogProjection(snapshot: TWidgetCatalogSnapshot): TWidgetAuthoringCatalog {
  return Object.freeze({
    generation: snapshot.generation,
    digestSha256: snapshot.digestSha256,
    entries: Object.freeze(Object.values(snapshot.entries).map((entry) => Object.freeze({
      widgetKey: entry.slug,
      displayName: entry.draft?.manifest?.name
        ?? entry.published?.manifest?.name
        ?? entry.slug,
      draft: entry.draft === null
        ? null
        : Object.freeze({
            health: entry.draft.health,
            digestSha256: entry.draft.treeDigestSha256,
            relativePath: entry.draft.relativePath,
          }),
      published: entry.published !== null,
    }))),
  });
}

type TConfig = Readonly<{
  catalog: Pick<WidgetFilesystemRuntimeCatalog, 'current' | 'refresh'>;
  workspace: Promise<Pick<NodeWidgetFilesystemWorkspace, 'rootPath' | 'captureDraftBuildInput'>>;
  buildGenerations: Pick<
    WidgetBuildGenerationService,
    'rebuild' | 'requireCurrent' | 'view'
  >;
  sourceCheck: (args: Readonly<{
    files: readonly Readonly<{ path: string; bytes: Uint8Array }>[];
    canonicalManifestJson: string;
    signal: AbortSignal;
  }>) => Promise<TOfflineCheckReport>;
  preview: Pick<WidgetPreviewService, 'inspect'>;
  screenshotLeases: Pick<WidgetScreenshotLeaseService, 'issue'>;
}>;

/** One host-owned authoring verification facade shared by AI Chat and private RPC. */
export class WidgetAuthoringVerificationService implements IWidgetAuthoringVerification {
  readonly #config: TConfig;

  constructor(config: TConfig) {
    this.#config = config;
  }

  async resolve(
    selector: TWidgetAuthoringDraftSelector,
    signal = new AbortController().signal,
  ): Promise<TWidgetAuthoringResolvedDraft> {
    assertAuthoringActive(signal);
    const [snapshot, workspace] = await Promise.all([
      this.#config.catalog.refresh(),
      this.#config.workspace,
    ]);
    assertAuthoringActive(signal);
    const decision = fnResolveWidgetAuthoringDraft({
      catalog: catalogProjection(snapshot),
      selector,
    });
    if (!decision.ok) throw authoringError(decision.failure.code, decision.failure.message);
    const captured = await workspace.captureDraftBuildInput({
      slug: decision.resolution.widgetKey,
      signal,
    });
    assertAuthoringActive(signal);
    const confirmedCatalog = await this.#config.catalog.refresh();
    assertAuthoringActive(signal);
    const confirmedDraft = confirmedCatalog.entries[decision.resolution.widgetKey]?.draft;
    if (
      confirmedCatalog.digestSha256 !== decision.resolution.catalogDigestSha256
      || confirmedDraft?.health !== 'healthy'
      || confirmedDraft.treeDigestSha256 !== decision.resolution.draftDigestSha256
      || captured.fileSetDigestSha256 !== decision.resolution.draftDigestSha256
      || captured.slug !== decision.resolution.widgetKey
      || captured.manifest.slug !== decision.resolution.widgetKey
      || captured.manifest.name !== decision.resolution.displayName
    ) throw authoringError(
      'WIDGET_CATALOG_CHANGED',
      'The exact draft changed while its automation identity was being captured.',
    );
    return Object.freeze({
      catalogGeneration: decision.resolution.catalogGeneration,
      catalogDigestSha256: decision.resolution.catalogDigestSha256,
      widgetKey: decision.resolution.widgetKey,
      displayName: decision.resolution.displayName,
      health: 'healthy',
      draftDigestSha256: captured.treeDigestSha256,
      draftPath: join(workspace.rootPath, decision.resolution.draftRelativePath),
    });
  }

  async validate(args: Readonly<{
    widgetKey: string;
    expectedDraftDigestSha256?: string;
    signal?: AbortSignal;
  }>): Promise<TWidgetAuthoringValidationResult> {
    const selected = await this.resolve({ widgetKey: args.widgetKey }, args.signal);
    if (
      args.expectedDraftDigestSha256 !== undefined
      && args.expectedDraftDigestSha256 !== selected.draftDigestSha256
    ) throw authoringError(
      'WIDGET_DRAFT_DIGEST_STALE',
      'The selected draft changed after the requested digest fence was observed.',
    );
    const workspace = await this.#config.workspace;
    const capture = await workspace.captureDraftBuildInput({
      slug: selected.widgetKey,
      signal: args.signal ?? new AbortController().signal,
    });
    if (
      capture.slug !== selected.widgetKey
      || capture.manifest.slug !== selected.widgetKey
      || capture.manifest.name !== selected.displayName
      || capture.treeDigestSha256 !== selected.draftDigestSha256
    ) throw authoringError(
      'WIDGET_CATALOG_CHANGED',
      'The exact draft changed while source validation was being captured.',
    );

    const validationSignal = args.signal ?? new AbortController().signal;
    let offlineReport: TOfflineCheckReport;
    try {
      offlineReport = await this.#config.sourceCheck({
        files: capture.files,
        canonicalManifestJson: capture.canonicalManifestJson,
        signal: validationSignal,
      });
    } catch (error) {
      if (validationSignal.aborted) throw error;
      offlineReport = Object.freeze({
        schemaVersion: 1,
        ok: false,
        scope: 'offline-project',
        checks: Object.freeze([Object.freeze({
          phase: 'project',
          code: 'SOURCE_CHECK_UNAVAILABLE',
          severity: 'error',
          summary: safeDiagnostic(error).message,
          location: Object.freeze({ file: 'widget://.' }),
        })]),
        limitations: Object.freeze([
          'resource-existence-not-checked',
          'preview-runtime-not-checked',
        ] as const),
        truncated: false,
      });
    }
    const confirmedCapture = await workspace.captureDraftBuildInput({
      slug: selected.widgetKey,
      signal: validationSignal,
    });
    if (
      confirmedCapture.slug !== capture.slug
      || confirmedCapture.manifest.slug !== capture.manifest.slug
      || confirmedCapture.manifest.name !== capture.manifest.name
      || confirmedCapture.treeDigestSha256 !== capture.treeDigestSha256
      || confirmedCapture.fileSetDigestSha256 !== capture.fileSetDigestSha256
    ) throw authoringError(
      'WIDGET_CATALOG_CHANGED',
      'The exact draft changed while the current SDK source policy was being checked.',
    );

    const files = [
      'omnidraw.json',
      ...confirmedCapture.files.map((file) => file.path),
    ].sort();
    const manifestValidation = fnValidateManifest(capture.manifest);
    const requiredValidation = fnLintRequiredWidgetFiles({
      files,
      manifest: manifestValidation.ok ? capture.manifest : undefined,
    });
    const sourceDiagnostics = Object.freeze([
      ...manifestValidation.errors,
      ...requiredValidation.errors,
    ].map((message, index) => Object.freeze({
      code: `SOURCE_VALIDATION_${String(index + 1).padStart(3, '0')}`,
      message: message.slice(0, 2_000),
      path: null,
    } as TWidgetAuthoringDiagnostic))
      .concat(offlineReport.checks.map(offlineDiagnostic))
      .slice(0, MAX_SOURCE_DIAGNOSTICS));
    if (sourceDiagnostics.length > 0) {
      return Object.freeze({
        ok: false,
        widgetKey: selected.widgetKey,
        displayName: selected.displayName,
        selectedCatalogGeneration: selected.catalogGeneration,
        selectedCatalogDigestSha256: selected.catalogDigestSha256,
        capturedDraftDigestSha256: capture.treeDigestSha256,
        executableInputDigestSha256: null,
        acceptedGeneration: null,
        buildIdentity: null,
        sourceValidation: Object.freeze({
          status: 'failed',
          diagnostics: sourceDiagnostics,
          files: Object.freeze(files.slice(0, MAX_SOURCE_FILES)),
          filesTruncated: files.length > MAX_SOURCE_FILES,
        }),
        acceptedArtifactBuild: Object.freeze({
          status: 'not_run',
          diagnostics: Object.freeze([]),
        }),
        livePreviewRuntime: 'not_exercised',
        resources: 'not_exercised',
      });
    }

    try {
      const accepted = await this.#config.buildGenerations.rebuild(
        selected.widgetKey,
        args.signal,
      );
      if (
        accepted.widgetKey !== selected.widgetKey
        || accepted.capture.slug !== selected.widgetKey
        || accepted.capture.treeDigestSha256 !== capture.treeDigestSha256
      ) throw authoringError(
        'WIDGET_BUILD_SUPERSEDED',
        'The widget source changed before the host could accept the selected build.',
      );
      const current = await this.#config.catalog.refresh();
      const currentDraft = current.entries[selected.widgetKey]?.draft;
      if (
        currentDraft?.health !== 'healthy'
        || currentDraft.treeDigestSha256 !== accepted.capture.fileSetDigestSha256
      ) throw authoringError(
        'WIDGET_CATALOG_CHANGED',
        'The accepted build no longer matches the current catalog draft.',
      );
      return Object.freeze({
        ok: true,
        widgetKey: selected.widgetKey,
        displayName: selected.displayName,
        selectedCatalogGeneration: selected.catalogGeneration,
        selectedCatalogDigestSha256: selected.catalogDigestSha256,
        capturedDraftDigestSha256: accepted.capture.treeDigestSha256,
        executableInputDigestSha256: accepted.receipt.executableInputDigestSha256,
        acceptedGeneration: accepted.generation,
        buildIdentity: accepted.receipt.buildIdentity,
        sourceValidation: Object.freeze({
          status: 'passed',
          diagnostics: Object.freeze([]),
          files: Object.freeze(files.slice(0, MAX_SOURCE_FILES)),
          filesTruncated: files.length > MAX_SOURCE_FILES,
        }),
        acceptedArtifactBuild: Object.freeze({
          status: 'passed',
          diagnostics: Object.freeze([]),
        }),
        livePreviewRuntime: 'not_exercised',
        resources: 'not_exercised',
      });
    } catch (error) {
      if (args.signal?.aborted) throw error;
      const state = await this.#config.buildGenerations.view(selected.widgetKey).catch(() => null);
      const diagnostics = state?.diagnostics.length
        ? Object.freeze(state.diagnostics.slice(0, MAX_SOURCE_DIAGNOSTICS).map((diagnostic) => Object.freeze({
            code: /^[A-Z][A-Z0-9_]{0,127}$/.test(diagnostic.code)
              ? diagnostic.code
              : 'WIDGET_BUILD_FAILED',
            message: safeDiagnosticMessage(diagnostic.message),
            path: safeDiagnosticPath(diagnostic.path),
          })))
        : Object.freeze([safeDiagnostic(error)]);
      return Object.freeze({
        ok: false,
        widgetKey: selected.widgetKey,
        displayName: selected.displayName,
        selectedCatalogGeneration: selected.catalogGeneration,
        selectedCatalogDigestSha256: selected.catalogDigestSha256,
        capturedDraftDigestSha256: capture.treeDigestSha256,
        executableInputDigestSha256: null,
        acceptedGeneration: null,
        buildIdentity: null,
        sourceValidation: Object.freeze({
          status: 'passed',
          diagnostics: Object.freeze([]),
          files: Object.freeze(files.slice(0, MAX_SOURCE_FILES)),
          filesTruncated: files.length > MAX_SOURCE_FILES,
        }),
        acceptedArtifactBuild: Object.freeze({ status: 'failed', diagnostics }),
        livePreviewRuntime: 'not_exercised',
        resources: 'not_exercised',
      });
    }
  }

  async inspect(args: Parameters<IWidgetAuthoringVerification['inspect']>[0]): Promise<TWidgetAuthoringInspectionResult> {
    if (args.mode === 'artifact' && args.canvasId !== undefined) {
      throw authoringError(
        'WIDGET_PREVIEW_INSPECT_INPUT_INVALID',
        'Canvas correlation is available only in preview mode.',
      );
    }
    const selected = await this.resolve({ widgetKey: args.widgetKey }, args.signal);
    if (selected.draftDigestSha256 !== args.expectedDraftDigestSha256) {
      throw authoringError(
        'WIDGET_DRAFT_DIGEST_STALE',
        'The current draft does not match the required inspection digest fence.',
      );
    }
    const accepted = await this.#config.buildGenerations.requireCurrent(
      selected.widgetKey,
      args.signal,
    );
    if (
      accepted.generation !== args.expectedAcceptedGeneration
      || accepted.receipt.buildIdentity !== args.expectedBuildIdentity
      || accepted.capture.treeDigestSha256 !== args.expectedDraftDigestSha256
    ) throw authoringError(
      'PREVIEW_GENERATION_CHANGED',
      'The exact accepted generation or build identity changed before inspection.',
    );

    const normalized = fnNormalizeWidgetPreviewInspectInput({
      name: selected.displayName,
      mode: args.mode,
      expectedDraftDigestSha256: args.expectedDraftDigestSha256,
      expectedAcceptedGeneration: args.expectedAcceptedGeneration,
      expectedBuildIdentity: args.expectedBuildIdentity,
      ...(args.viewport === undefined ? {} : { viewport: args.viewport }),
      ...(args.settle === undefined ? {} : { settle: args.settle }),
      ...(args.actions === undefined ? {} : { actions: args.actions }),
      ...(args.continueOnActionError === undefined
        ? {}
        : { continueOnActionError: args.continueOnActionError }),
      ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
    });
    if (!normalized.ok) throw authoringError(
      'WIDGET_PREVIEW_INSPECT_INPUT_INVALID',
      normalized.message,
    );
    const response = await this.#config.preview.inspect(Object.freeze({
      subject: Object.freeze({
        kind: 'automation' as const,
        operationId: args.operationId,
        ...(args.canvasId === undefined ? {} : { canvasId: args.canvasId }),
      }),
      name: selected.displayName,
      widgetKey: selected.widgetKey,
      input: normalized.value,
      ...(args.signal === undefined ? {} : { signal: args.signal }),
    }));
    if ('toolError' in response) {
      return Object.freeze({
        ok: false,
        widgetKey: selected.widgetKey,
        draftDigestSha256: args.expectedDraftDigestSha256,
        acceptedGeneration: args.expectedAcceptedGeneration,
        buildIdentity: args.expectedBuildIdentity,
        canvasCorrelation: Object.freeze({
          canvas: args.canvasId === undefined ? 'not_selected' : 'selected',
          visibleFrame: 'not_claimed',
        }),
        error: response.toolError,
      });
    }
    const screenshot = response.result.screenshot;
    const protocol = fnValidateWidgetPreviewInspectProtocol({
      result: response.result,
      expectedName: selected.displayName,
      expectedWidgetKey: selected.widgetKey,
      input: normalized.value,
      ...(response.screenshotPng === undefined || screenshot === undefined
        ? {}
        : {
            observedPng: Object.freeze({
              byteSize: response.screenshotPng.byteLength,
              digestSha256: createHash('sha256').update(response.screenshotPng).digest('hex'),
              width: screenshot.width,
              height: screenshot.height,
            }),
          }),
    });
    if (!protocol.ok) throw authoringError(
      'WIDGET_PREVIEW_INSPECT_PROTOCOL_INVALID',
      protocol.message,
    );
    const screenshotLease = args.includeScreenshot
      && response.screenshotPng !== undefined
      && screenshot !== undefined
      ? this.#config.screenshotLeases.issue({
          operationId: args.operationId,
          bytes: response.screenshotPng,
          mimeType: screenshot.mimeType,
          width: screenshot.width,
          height: screenshot.height,
          byteSize: screenshot.byteSize,
          digestSha256: screenshot.digestSha256,
        })
      : undefined;
    return Object.freeze({
      ok: response.result.status === 'completed',
      widgetKey: selected.widgetKey,
      draftDigestSha256: args.expectedDraftDigestSha256,
      acceptedGeneration: args.expectedAcceptedGeneration,
      buildIdentity: args.expectedBuildIdentity,
      canvasCorrelation: Object.freeze({
        canvas: args.canvasId === undefined ? 'not_selected' : 'selected',
        visibleFrame: 'not_claimed',
      }),
      result: response.result,
      ...(screenshotLease === undefined ? {} : { screenshotLease }),
    });
  }
}
