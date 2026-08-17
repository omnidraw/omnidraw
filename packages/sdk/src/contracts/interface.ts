/**
 * @file Narrow public capabilities for widget build, publication, artifact access, and GC.
 */

import type {
  TWidgetArtifactConstructionRequest,
  TWidgetArtifactConstructionResult,
  TWidgetArtifactConstructionSignRequest,
  TWidgetBrowserArtifact,
  TWidgetBrowserMountDiagnostics,
  TWidgetArtifactInspectionRequest,
  TWidgetArtifactInspectionResult,
  TWidgetArtifactSignRequest,
  TWidgetArtifactSignResult,
  TWidgetHostConfiguration,
  TWidgetRuntimeDescriptor,
  TWidgetRuntimeDescriptorCreateRequest,
  TWidgetUiArtifact,
  TWidgetUiBuildRequest,
  TWidgetBuildRequest,
  TWidgetBuildResult,
  TWidgetServerFunctionDescriptor,
  TWidgetServerFunctionDescriptorExtractionRequest,
  TWidgetFunctionInvocation,
  TWidgetHostDiagnostic,
  TWidgetHostSubject,
  TWidgetInspectionCanvas,
  TWidgetInspectionPointCheck,
  TWidgetInspectionQuery,
  TWidgetInspectionTarget,
  TWidgetPortableArtifact,
  TWidgetResourceCall,
  TWidgetSerializableJsonValue,
  TWidgetStateEvent,
  TWidgetStateSnapshot,
  TWidgetViewport,
} from './types';

export interface IWidgetHostConfigurationReader {
  read(): Promise<TWidgetHostConfiguration>;
}

export interface IWidgetArtifactBuilder {
  build(request: TWidgetBuildRequest): Promise<TWidgetBuildResult>;
}

/** Builds exact unsigned UI/source/server outputs without selecting signing authority. */
export interface IWidgetArtifactConstructor {
  construct(
    request: TWidgetArtifactConstructionRequest,
  ): Promise<TWidgetArtifactConstructionResult>;
  closeWorkspace?(
    request: Readonly<{ workspaceKey: string }>,
  ): Promise<void>;
  close?(): Promise<void>;
}

/** Applies Preview or release signing to one already-built immutable construction. */
export interface IWidgetArtifactConstructionSigner {
  signConstruction(
    request: TWidgetArtifactConstructionSignRequest,
  ): Promise<TWidgetBuildResult>;
}

/** Exact construction and signing seam for one filesystem publication. */
export interface IWidgetArtifactConstructionBuilder
  extends IWidgetArtifactBuilder, IWidgetArtifactConstructor, IWidgetArtifactConstructionSigner {}

/** Trusted build port; implementations map Omnidraw inputs to public Capsule build APIs. */
export interface IWidgetUiArtifactBuilder {
  buildUiArtifact(
    request: TWidgetUiBuildRequest,
  ): Promise<TWidgetUiArtifact>;
}

/** Trusted bytes-in/bytes-out signing port. Private signing material is never part of this contract. */
export interface IWidgetArtifactSigner {
  signArtifact(
    request: TWidgetArtifactSignRequest,
  ): Promise<TWidgetArtifactSignResult>;
}

/** Verifies exact signed bytes and returns only serializable Capsule runtime metadata. */
export interface IWidgetArtifactInspector {
  inspectArtifact(
    request: TWidgetArtifactInspectionRequest,
  ): Promise<TWidgetArtifactInspectionResult>;
}

export interface IWidgetRuntimeDescriptorFactory {
  createRuntimeDescriptor(
    request: TWidgetRuntimeDescriptorCreateRequest,
  ): TWidgetRuntimeDescriptor;
}

/**
 * Loads an already-built server artifact only inside a bounded descriptor-
 * extraction guest and returns its generated, serializable named-export descriptors.
 */
export interface IWidgetServerFunctionDescriptorExtractor {
  extractServerFunctionDescriptors(
    request: TWidgetServerFunctionDescriptorExtractionRequest,
  ): Promise<readonly TWidgetServerFunctionDescriptor[]>;
}

/** Product-neutral state authority implemented separately by OSS and managed. */
export interface IWidgetStateHostPort {
  get<TValue extends TWidgetSerializableJsonValue = TWidgetSerializableJsonValue>(
    subject: TWidgetFunctionInvocation['subject'],
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<TWidgetStateSnapshot<TValue>>;
  change<TValue extends TWidgetSerializableJsonValue = TWidgetSerializableJsonValue>(
    subject: TWidgetFunctionInvocation['subject'],
    expectedVersion: number,
    value: TValue,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<TWidgetStateSnapshot<TValue>>;
  events<TValue extends TWidgetSerializableJsonValue = TWidgetSerializableJsonValue>(
    subject: TWidgetFunctionInvocation['subject'],
    afterVersion: number,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): AsyncIterable<TWidgetStateEvent<TValue>>;
  dispose?(): void | Promise<void>;
}

export interface IWidgetResourceHostPort {
  call<TOutput extends TWidgetSerializableJsonValue = TWidgetSerializableJsonValue>(
    request: TWidgetResourceCall,
  ): Promise<TOutput>;
}

export interface IWidgetFunctionHostPort {
  invoke<TOutput extends TWidgetSerializableJsonValue = TWidgetSerializableJsonValue>(
    request: TWidgetFunctionInvocation,
  ): Promise<TOutput>;
  dispose?(): void | Promise<void>;
}

export type TWidgetMount = Readonly<{
  setProps(value: TWidgetSerializableJsonValue): void;
  setTheme(value: import('./types').TWidgetTheme): void;
  focus(): void;
  dispose(reason?: string): Promise<void>;
}>;

/** Common host bridge. Capsule, process, adapter, and metering details stay private. */
export interface IWidgetHostBridge {
  validateArtifact(artifact: TWidgetPortableArtifact): Promise<void>;
  mount(request: Readonly<{
    artifact: TWidgetPortableArtifact;
    subject: TWidgetFunctionInvocation['subject'];
    container: HTMLElement;
    props: TWidgetSerializableJsonValue;
    theme: import('./types').TWidgetTheme;
    signal?: AbortSignal;
  }>): Promise<TWidgetMount>;
  functions: IWidgetFunctionHostPort;
  resources: IWidgetResourceHostPort;
  state: IWidgetStateHostPort;
  dispose(): Promise<void>;
}

export interface IWidgetOutputHostPort {
  notification(value: import('./types').TWidgetNotificationOutput): void;
}

export type TWidgetBrowserHostOptions = Readonly<{
  document: Document;
  catalog:
    | import('./types').TWidgetHostConfiguration
    | (() => import('./types').TWidgetHostConfiguration
      | Promise<import('./types').TWidgetHostConfiguration>);
  createId?: () => string;
  digestSha256?: (bytes: Uint8Array) => string | Promise<string>;
  artifactCache?: Readonly<{
    maxEntries?: number;
    maxTotalBytes?: number;
    maxArtifactBytes?: number;
  }>;
}>;

export type TWidgetBrowserMountRequest = Readonly<{
  mode: 'preview' | 'published';
  artifact: TWidgetBrowserArtifact;
  /** Canonical path-free descriptors may arrive beside artifact bytes over application transport. */
  functionDescriptors?: readonly import('./types').TWidgetServerFunctionDescriptor[];
  container: HTMLElement;
  subject: TWidgetHostSubject;
  viewport: TWidgetViewport;
  props?: import('./types').TWidgetProps;
  theme: import('./types').TWidgetTheme;
  functions?: IWidgetFunctionHostPort;
  state?: IWidgetStateHostPort;
  output?: IWidgetOutputHostPort;
  restoreSnapshot?: Uint8Array;
  signal?: AbortSignal;
  onDiagnostic?: (diagnostic: TWidgetHostDiagnostic) => void;
  onFatal?: (error: unknown) => void;
}>;

export interface IWidgetBrowserMount {
  ready(): Promise<void>;
  setProps(value: import('./types').TWidgetProps): void;
  setTheme(value: import('./types').TWidgetTheme): void;
  setViewport(value: TWidgetViewport): void;
  focus(options?: FocusOptions): void;
  setSchedulingMode(mode: 'active' | 'throttled'): Promise<void>;
  freeze(reason?: string): Promise<void>;
  resume(reason?: string): Promise<void>;
  snapshot(reason?: string): Promise<Uint8Array>;
  diagnostics(): TWidgetBrowserMountDiagnostics;
  dispose(reason?: string): Promise<void>;
}

export interface IWidgetAuthoringInspectionController {
  query(request: TWidgetInspectionQuery): readonly TWidgetInspectionTarget[];
  visibleSummary(request?: Readonly<{ maxResults?: number }>): readonly TWidgetInspectionTarget[];
  validateActionPoint(targetId: number): TWidgetInspectionPointCheck;
  canvases(request?: Readonly<{ maxResults?: number }>): readonly TWidgetInspectionCanvas[];
  dispose(): void;
}

export interface IWidgetBrowserInspectionMount extends IWidgetBrowserMount {
  readonly inspection: IWidgetAuthoringInspectionController;
}

export interface IWidgetBrowserHost {
  validateArtifact(input: unknown): Promise<TWidgetBrowserArtifact>;
  mount(request: TWidgetBrowserMountRequest): Promise<IWidgetBrowserMount>;
  inspect(request: TWidgetBrowserMountRequest): Promise<IWidgetBrowserInspectionMount>;
  dispose(): Promise<void>;
}
