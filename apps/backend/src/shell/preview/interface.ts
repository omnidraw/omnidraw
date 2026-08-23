import type { Browser, BrowserContext, Page } from 'playwright';
import type {
  TWidgetServerFunctionDescriptor,
  TWidgetHostConfiguration,
  TWidgetProps,
  TWidgetRuntimeDescriptor,
  TWidgetTheme,
} from '@omnidraw/sdk/contract';
import type {
  TPlaywrightRuntimeExecutableEvidence,
  TPlaywrightRuntimeIdentity,
} from './playwright-runtime-identity';

export type TPreviewInspectionTarget =
  | Readonly<{ by: 'css'; selector: string }>
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
  | Readonly<{ by: 'label'; text: string; exact?: boolean }>;

export type TPreviewInspectionBrowserAction =
  | Readonly<{ type: 'click'; target: TPreviewInspectionTarget }>
  | Readonly<{
      type: 'input';
      target: TPreviewInspectionTarget;
      value: string;
      commit?: 'none' | 'blur' | 'enter';
    }>
  | Readonly<{
      type: 'assertText';
      target: TPreviewInspectionTarget;
      text: string;
      exact?: boolean;
    }>
  | Readonly<{ type: 'waitFrames'; count: number }>;

export type TPreviewInspectionFunctionBridge = Readonly<{
  invoke(request: Readonly<{
    functionName: string;
    input: unknown;
    signal: AbortSignal;
  }>): Promise<unknown>;
  dispose(): void | Promise<void>;
}>;

export type TPreviewInspectionBrowserJob = Readonly<{
  format: 'omnidraw.preview-inspection-browser-job.v1';
  jobId: string;
  ownerKey: string;
  widgetKey: string;
  artifact: Readonly<{
    bytes: Uint8Array;
    digestSha256: string;
    artifactHash: `sha256:${string}`;
    runtimeDescriptor: TWidgetRuntimeDescriptor;
  }>;
  hostConfiguration: TWidgetHostConfiguration;
  functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
  browserFunctionDescriptorsDigestSha256: string;
  functionBridge: TPreviewInspectionFunctionBridge;
  props?: TWidgetProps;
  theme: TWidgetTheme;
  viewport: Readonly<{
    width: number;
    height: number;
    deviceScaleFactor: 1 | 2;
  }>;
  settleFrames: number;
  settleTimeoutMs: number;
  actions: readonly TPreviewInspectionBrowserAction[];
  continueOnActionError: boolean;
  timeoutMs?: number;
  signal: AbortSignal;
}>;

export type TPreviewInspectionBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type TPreviewInspectionBrowserTarget = Readonly<{
  id: number;
  tag: string;
  role?: string;
  name?: string;
  text?: string;
  bounds: TPreviewInspectionBounds;
  computed: Readonly<{
    display: string;
    visibility: string;
    opacity: string;
  }>;
  state?: Readonly<{
    checked?: boolean;
    disabled?: boolean;
    expanded?: boolean;
    selected?: boolean;
  }>;
  editable: boolean;
  sensitive: boolean;
}>;

export type TPreviewInspectionBrowserCanvas = Readonly<{
  id: number;
  bounds: TPreviewInspectionBounds;
  width: number;
  height: number;
  context: '2d' | 'webgl' | 'webgl2' | 'webgpu' | 'unknown';
  contextLost: boolean;
}>;

export type TPreviewInspectionBrowserActionResult = Readonly<{
  index: number;
  type: TPreviewInspectionBrowserAction['type'];
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
  target?: TPreviewInspectionBrowserTarget;
}>;

export type TPreviewInspectionRuntimeEvent = Readonly<{
  origin: string;
  phase: string;
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  artifactHash?: string;
  runtimeGeneration?: number;
  lifecycleGeneration?: number;
  location?: Readonly<{
    module: string;
    line: number;
    column: number;
  }>;
}>;

export type TPreviewInspectionBrowserResult = Readonly<{
  format: 'omnidraw.preview-inspection-browser-result.v1';
  jobId: string;
  artifactDigestSha256: string;
  artifactHash: `sha256:${string}`;
  runtimeGeneration: number;
  lifecycleGeneration: number;
  screenshotPng: Uint8Array;
  screenshotDigestSha256: string;
  screenshotWidth: number;
  screenshotHeight: number;
  scannedElements: number;
  actionResults: readonly TPreviewInspectionBrowserActionResult[];
  targets: readonly TPreviewInspectionBrowserTarget[];
  canvases: readonly TPreviewInspectionBrowserCanvas[];
  runtimeEvents: readonly TPreviewInspectionRuntimeEvent[];
  droppedCounts: Readonly<{
    targets: number;
    canvases: number;
    runtimeEvents: number;
  }>;
}>;

/** Bounded shell evidence retained only after the process-owned validator accepts it. */
export type TPreviewInspectionBrowserFailureEvidence = Readonly<{
  artifactHash: `sha256:${string}`;
  runtimeGeneration: number;
  lifecycleGeneration: number;
  runtimeEvents: readonly TPreviewInspectionRuntimeEvent[];
  droppedRuntimeEventCount: number;
}>;

export type TPreviewInspectionBrowserPreflight =
  | Readonly<{
      ok: true;
      runtime: typeof import('./CONSTANTS')['PREVIEW_INSPECTION_BROWSER_RUNTIME'];
      executablePath: string;
      shellPath: string;
    }>
  | Readonly<{
      ok: false;
      code:
        | 'BROWSER_RUNTIME_UNAVAILABLE'
        | 'BROWSER_RUNTIME_IDENTITY_INVALID'
        | 'BROWSER_EXECUTABLE_MISSING'
        | 'BROWSER_VERSION_MISMATCH'
        | 'INSPECTION_SHELL_MISSING'
        | 'INSPECTION_SHELL_UNVERIFIED';
      message: string;
      remediation: string;
    }>;

export type TPreviewInspectionBrowserLauncher = Readonly<{
  launch(args: Readonly<{
    downloadsPath: string;
    executablePath: string;
    timeoutMs: number;
  }>): Promise<Browser>;
  runtimeExecutableEvidence(): Promise<TPlaywrightRuntimeExecutableEvidence>;
  runtimeIdentityFromEvidence(
    evidence: TPlaywrightRuntimeExecutableEvidence,
  ): Promise<TPlaywrightRuntimeIdentity>;
}>;

export type TPreviewInspectionBrowserInternals = Readonly<{
  createContext(browser: Browser, job: TPreviewInspectionBrowserJob): Promise<BrowserContext>;
  createPage(context: BrowserContext): Promise<Page>;
}>;

export type TPreviewInspectionShellLease = Readonly<{
  url: string;
  release(): void;
}>;

export type TPreviewInspectionShellBuild = Readonly<{
  buildId: `sha256:${string}`;
  rootPath: string;
}>;

export type TPreviewInspectionShellLeasePort = Readonly<{
  path: string;
  verify(): Promise<TPreviewInspectionShellBuild>;
  open(jobId: string): Promise<TPreviewInspectionShellLease>;
  stop(): Promise<void>;
}>;

export type TPreviewInspectionShellPointCheck = Readonly<{
  targetId: number;
  valid: boolean;
  reason:
    | 'valid'
    | 'missing'
    | 'stale'
    | 'not_visible'
    | 'disabled'
    | 'outside_viewport'
    | 'occluded';
  centerX?: number;
  centerY?: number;
}>;

export type TPreviewInspectionShellFocusedTargetCheck = Readonly<{
  targetId: number;
  valid: boolean;
  reason:
    | 'valid'
    | 'missing'
    | 'stale'
    | 'not_visible'
    | 'disabled'
    | 'sensitive'
    | 'not_editable'
    | 'not_focused';
}>;

export type TPreviewInspectionKeyboardOperation =
  | 'delete_backward'
  | 'insert_text'
  | 'commit_enter';

export type TPreviewInspectionKeyboardGuardReason =
  | 'valid'
  | 'focus_redirected'
  | 'selection_outside_target'
  | 'event_missing'
  | 'event_mismatch'
  | 'stale';

export type TPreviewInspectionKeyboardGuardTicket = Readonly<{
  guardId: number;
  targetId: number;
  operation: TPreviewInspectionKeyboardOperation;
}>;

export type TPreviewInspectionKeyboardGuardResult = Readonly<{
  guardId: number;
  targetId: number;
  operation: TPreviewInspectionKeyboardOperation;
  valid: boolean;
  reason: TPreviewInspectionKeyboardGuardReason;
  keydownObserved: boolean;
  beforeinputObserved: boolean;
  defaultPrevented: boolean;
}>;

export type TPreviewInspectionShellSnapshot = Readonly<{
  artifactDigestSha256: string;
  artifactHash: `sha256:${string}`;
  runtimeGeneration: number;
  lifecycleGeneration: number;
  scannedElements: number;
  targets: readonly TPreviewInspectionBrowserTarget[];
  canvases: readonly TPreviewInspectionBrowserCanvas[];
  runtimeEvents: readonly TPreviewInspectionRuntimeEvent[];
  droppedCounts: Readonly<{
    targets: number;
    canvases: number;
    runtimeEvents: number;
  }>;
}>;

export type TPreviewInspectionShellDriver = Readonly<{
  mount(args: Readonly<{
    page: Page;
    url: string;
    job: TPreviewInspectionBrowserJob;
    signal: AbortSignal;
  }>): Promise<void>;
  query(args: Readonly<{
    page: Page;
    target: TPreviewInspectionTarget;
    signal: AbortSignal;
  }>): Promise<readonly TPreviewInspectionBrowserTarget[]>;
  validateActionPoint(args: Readonly<{
    page: Page;
    targetId: number;
    signal: AbortSignal;
  }>): Promise<TPreviewInspectionShellPointCheck>;
  validateFocusedTarget(args: Readonly<{
    page: Page;
    targetId: number;
    signal: AbortSignal;
  }>): Promise<TPreviewInspectionShellFocusedTargetCheck>;
  armNativeKeyboardGuard(args: Readonly<{
    page: Page;
    targetId: number;
    operation: TPreviewInspectionKeyboardOperation;
    signal: AbortSignal;
  }>): Promise<TPreviewInspectionKeyboardGuardTicket>;
  finishNativeKeyboardGuard(args: Readonly<{
    page: Page;
    guardId: number;
  }>): Promise<TPreviewInspectionKeyboardGuardResult>;
  waitFrames(args: Readonly<{
    page: Page;
    count: number;
    timeoutMs: number;
    signal: AbortSignal;
  }>): Promise<void>;
  snapshot(args: Readonly<{
    page: Page;
    signal: AbortSignal;
  }>): Promise<TPreviewInspectionShellSnapshot>;
  destroy(args: Readonly<{ page: Page; reason: string }>): Promise<void>;
}>;

export type TPreviewInspectionBrowserPort = Readonly<{
  preflight(): Promise<TPreviewInspectionBrowserPreflight>;
  run(job: TPreviewInspectionBrowserJob): Promise<TPreviewInspectionBrowserResult>;
  stop(): Promise<void>;
}>;
