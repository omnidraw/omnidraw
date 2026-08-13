import type { SessionManager, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { TValidationResult } from '../../../core/agent/types';
export type {
  TValidationResult,
  TWidgetDbChangeProposalRecord,
} from '../../../core/agent/types';

export type TToolEvent =
  { type: 'widgetupdate'; cwd: string; files: string[] };

export type TToolEventSink = (event: TToolEvent) => void | Promise<void>;

export type TWidgetDraftChange = {
  name: string;
  chatId?: string;
  type: 'created' | 'changed' | 'validated';
};

/** Notification sink fired after a draft mutation is durable on disk. */
export type TWidgetDraftChangeHandler = (
  change: TWidgetDraftChange,
) => void | Promise<void>;

/** Runs the real host accepted-artifact build for one shared draft slug. */
export type TWidgetPreviewBuildCheck = (args: Readonly<{
  slug: string;
}>) => Promise<Readonly<{ ok: boolean; errors: readonly string[] }>>;

export type TWidgetPreviewInspectTarget =
  | Readonly<{
      by: 'css';
      selector: string;
    }>
  | Readonly<{
      by: 'role';
      role:
        | 'button'
        | 'checkbox'
        | 'combobox'
        | 'link'
        | 'listbox'
        | 'menuitem'
        | 'option'
        | 'radio'
        | 'slider'
        | 'spinbutton'
        | 'switch'
        | 'tab'
        | 'textbox';
      name?: string;
      exact?: boolean;
    }>
  | Readonly<{
      by: 'label';
      text: string;
      exact?: boolean;
    }>;

export type TWidgetPreviewInspectAction =
  | Readonly<{
      type: 'click';
      target: TWidgetPreviewInspectTarget;
    }>
  | Readonly<{
      type: 'input';
      target: TWidgetPreviewInspectTarget;
      value: string;
      commit?: 'none' | 'blur' | 'enter';
    }>
  | Readonly<{
      type: 'waitFrames';
      count: number;
    }>
  | Readonly<{
      type: 'assertText';
      target: TWidgetPreviewInspectTarget;
      text: string;
      exact?: boolean;
    }>;

/** Frozen, model-facing input accepted by `od_widget_preview_inspect`. */
export type TWidgetPreviewInspectInput = Readonly<{
  name: string;
  mode?: 'artifact' | 'preview';
  expectedDraftDigestSha256?: string;
  expectedAcceptedGeneration?: number;
  viewport?: Readonly<{
    width?: number;
    height?: number;
    deviceScaleFactor?: 1 | 2;
  }>;
  settle?: Readonly<{
    frames?: number;
    timeoutMs?: number;
  }>;
  actions?: readonly TWidgetPreviewInspectAction[];
  continueOnActionError?: boolean;
  timeoutMs?: number;
}>;

export type TWidgetPreviewInspectNormalizedAction =
  | Extract<TWidgetPreviewInspectAction, Readonly<{ type: 'click' }>>
  | Readonly<{
      type: 'input';
      target: TWidgetPreviewInspectTarget;
      value: string;
      commit: 'none' | 'blur' | 'enter';
    }>
  | Extract<TWidgetPreviewInspectAction, Readonly<{ type: 'waitFrames' }>>
  | Extract<TWidgetPreviewInspectAction, Readonly<{ type: 'assertText' }>>;

/** Fully defaulted input passed to the host capability after mounted-name resolution. */
export type TWidgetPreviewInspectNormalizedInput = Readonly<{
  name: string;
  mode: 'artifact' | 'preview';
  expectedDraftDigestSha256?: string;
  expectedAcceptedGeneration?: number;
  viewport: Readonly<{
    width: number;
    height: number;
    deviceScaleFactor: 1 | 2;
  }>;
  settle: Readonly<{
    frames: number;
    timeoutMs: number;
  }>;
  actions: readonly TWidgetPreviewInspectNormalizedAction[];
  continueOnActionError: boolean;
  timeoutMs: number;
}>;

export type TInspectStage =
  | 'scope'
  | 'build'
  | 'sign'
  | 'mount'
  | 'actions'
  | 'settle'
  | 'capture_screenshot';

export type TInspectFailure = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
}>;

export type TInspectIdentity = Readonly<{
  name: string;
  widgetKey: string;
  draftDigestSha256: string;
  executableInputDigestSha256: string;
  environmentIdentity: string;
}>;

export type TInspectArtifact = Readonly<{
  artifactDigestSha256: string;
  artifactHash: `sha256:${string}`;
  constructionReused: boolean;
}>;

export type TInspectScreenshot = Readonly<{
  mimeType: 'image/png';
  width: number;
  height: number;
  byteSize: number;
  digestSha256: string;
}>;

export type TInspectFidelity =
  | Readonly<{
      source: 'exact';
      artifact: 'exact';
      runtimePolicy: 'narrowed';
      bindings: 'unavailable';
      network: 'denied';
      overall: 'artifact_exact';
    }>
  | Readonly<{
      source: 'exact';
      artifact: 'exact';
      runtimePolicy: 'preview';
      bindings: 'manifest';
      network: 'denied';
      overall: 'preview_policy_exact';
    }>;

export type TInspectFunctional =
  | 'observed'
  | 'not_exercised'
  | 'not_verified_missing_reference'
  | 'blocked_write_approval'
  | 'failed';

export type TInspectVerification = Readonly<{
  surface: 'artifact' | 'preview';
  generation: 'current';
  artifact: 'exact';
  manifest: 'exact';
  resources: 'not_available' | 'manifest_bound';
  canvasParity: 'not_claimed' | 'same_runtime_policy';
  visibleFrame: 'not_claimed';
  executionTarget: 'diagnostic_clone';
  previewState:
    | 'not_applicable'
    | 'absent'
    | 'mounting'
    | 'failed'
    | 'ready'
    | 'retired'
    | 'ambiguous'
    | 'generation_mismatch';
  nextAction:
    | 'none'
    | 'repair_visible_preview'
    | 'retry_after_settle'
    | 'reopen_preview'
    | 'remove_duplicate_previews'
    | 'retry_current_generation'
    | 'use_preview_mode_for_resources';
  functional: TInspectFunctional;
}>;

export type TInspectBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type TInspectActionResult = Readonly<{
  index: number;
  type: TWidgetPreviewInspectAction['type'];
  status:
    | 'passed'
    | 'no_match'
    | 'ambiguous'
    | 'not_visible'
    | 'occluded'
    | 'disabled'
    | 'unsupported'
    | 'failed'
    | 'skipped';
  matchedCount: number;
  message: string;
  target?: Readonly<{
    id: number;
    tag: string;
    role?: string;
    name?: string;
    bounds: TInspectBounds;
  }>;
}>;

export type TInspectDiagnostic = Readonly<{
  fingerprint: string;
  origin:
    | 'source'
    | 'install'
    | 'build'
    | 'capsule'
    | 'host'
    | 'guest'
    | 'capability'
    | 'channel'
    | 'budget'
    | 'lifecycle';
  phase: string;
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  trust: 'trusted' | 'untrusted';
  retryability: 'retryable' | 'non-retryable' | 'unknown';
  occurrenceCount: number;
  location?: Readonly<{
    file: `widget://${string}`;
    line?: number;
    column?: number;
  }>;
  capability?: string;
  operation?: string;
}>;

export type TInspectElement = Readonly<{
  id: number;
  tag: string;
  role?: string;
  name?: string;
  text?: string;
  bounds: TInspectBounds;
  state?: Readonly<{
    checked?: boolean;
    disabled?: boolean;
    expanded?: boolean;
    selected?: boolean;
  }>;
  computed: Readonly<{
    display: string;
    visibility: string;
    opacity: string;
  }>;
}>;

export type TInspectCanvas = Readonly<{
  id: number;
  bounds: TInspectBounds;
  width: number;
  height: number;
  context: '2d' | 'webgl' | 'webgl2' | 'webgpu' | 'unknown';
}>;

export type TInspectEvidence = Readonly<{
  page: Readonly<{
    width: number;
    height: number;
    deviceScaleFactor: 1 | 2;
  }>;
  actions: readonly TInspectActionResult[];
  diagnostics: Readonly<{
    entries: readonly TInspectDiagnostic[];
    droppedCount: number;
    truncated: boolean;
  }>;
  elements: Readonly<{
    entries: readonly TInspectElement[];
    scannedCount: number;
    omittedCount: number;
    truncated: boolean;
  }>;
  canvases: Readonly<{
    entries: readonly TInspectCanvas[];
    omittedCount: number;
    truncated: boolean;
  }>;
}>;

export type TWidgetPreviewInspectResult =
  | Readonly<{
      status: 'completed';
      identity: TInspectIdentity;
      artifact: TInspectArtifact;
      fidelity: TInspectFidelity;
      verification: TInspectVerification;
      screenshot: TInspectScreenshot;
      evidence: TInspectEvidence;
      durationMs: number;
    }>
  | Readonly<{
      status: 'completed_with_errors';
      identity: TInspectIdentity;
      artifact: TInspectArtifact;
      fidelity: TInspectFidelity;
      verification: TInspectVerification;
      screenshot: TInspectScreenshot;
      evidence: TInspectEvidence;
      durationMs: number;
    }>
  | Readonly<{
      status: 'failed';
      stage: TInspectStage;
      failure: TInspectFailure;
      identity: TInspectIdentity;
      verification: TInspectVerification;
      artifact?: TInspectArtifact;
      screenshot?: TInspectScreenshot;
      evidence?: Partial<TInspectEvidence>;
      durationMs: number;
    }>
  | Readonly<{
      status: 'timed_out' | 'cancelled';
      stage: TInspectStage;
      failure: TInspectFailure;
      identity: TInspectIdentity;
      verification: TInspectVerification;
      artifact?: TInspectArtifact;
      screenshot?: TInspectScreenshot;
      durationMs: number;
    }>;

export type TWidgetPreviewInspectionRequest = Readonly<{
  chatId: string;
  toolCallId: string;
  name: string;
  widgetKey: string;
  input: TWidgetPreviewInspectNormalizedInput;
  scope?: Readonly<{
    canvasId: string;
    aiChatElementId: string;
  }>;
  signal?: AbortSignal;
}>;

export type TWidgetPreviewInspectionToolError = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
  /** Safe observed value returned only for a stale draft-digest fence. */
  observedDraftDigestSha256?: string;
  previewState?: TInspectVerification['previewState'];
  nextAction?: TInspectVerification['nextAction'];
  diagnostics?: readonly TInspectDiagnostic[];
}>;

export type TWidgetPreviewInspectionResponse =
  | Readonly<{
      result: TWidgetPreviewInspectResult;
      /** Present exactly when `result` carries screenshot metadata. */
      screenshotPng?: Uint8Array;
    }>
  | Readonly<{
      /** Boundary failures before an inspection result identity exists. */
      toolError: TWidgetPreviewInspectionToolError;
    }>;

/** Host edge that owns exact construction, isolated browser execution, and cleanup. */
export type TWidgetPreviewInspectionCapability = Readonly<{
  inspect(args: TWidgetPreviewInspectionRequest): Promise<TWidgetPreviewInspectionResponse>;
}>;

export type TToolDefinition = ToolDefinition<any, unknown, any>;

export type TSessionEntryManager = Pick<SessionManager, 'appendCustomEntry' | 'getEntries'>;
