import type { TOrpcSafeClient } from '@vibecanvas/orpc-client';
import type { TElement } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import type {
  TWidgetUiArtifactEnvelopeV1,
  TWidgetUiArtifactOutput,
} from '@vibecanvas/widget-contract/browser';

type TApi = TOrpcSafeClient['api'];

export type TWidgetRuntimeIdentity = Readonly<{
  orgId: string;
  canvasId: string;
  elementId: string;
  widgetInstanceId: string;
  definitionId: string;
  revisionId: string;
}>;

export type TWidgetRuntimeLoadRequest = Omit<TWidgetRuntimeIdentity, 'orgId'>;

export type TWidgetRuntimeLocalTarget = TWidgetRuntimeLoadRequest & Readonly<{
  stateDocumentId: string | null;
}>;

export type TWidgetCollaborativeJsonValue =
  | string
  | number
  | boolean
  | null
  | TWidgetCollaborativeJsonValue[]
  | { [key: string]: TWidgetCollaborativeJsonValue };

export type TWidgetCollaborativeStateIdentity = TWidgetRuntimeIdentity & Readonly<{
  stateDocumentId: string;
}>;

export type TWidgetCollaborativeStateDocument = Readonly<{
  schemaVersion: 1;
  identity: TWidgetCollaborativeStateIdentity;
  state: TWidgetCollaborativeJsonValue;
}>;

export type TMutableWidgetCollaborativeStateDocument = {
  schemaVersion: 1;
  identity: TWidgetCollaborativeStateIdentity;
  state: TWidgetCollaborativeJsonValue;
};

export type TWidgetCollaborativeStateSnapshot = Readonly<{
  version: number;
  value: TWidgetCollaborativeJsonValue;
}>;

export type TWidgetCollaborativeStateSession = Readonly<{
  identity: TWidgetCollaborativeStateIdentity;
  get(): Promise<TWidgetCollaborativeStateSnapshot>;
  change(value: TWidgetCollaborativeJsonValue): Promise<TWidgetCollaborativeStateSnapshot>;
  next(afterVersion: number, waitId: string): Promise<TWidgetCollaborativeStateSnapshot>;
  cancel(waitId: string): void;
  dispose(): void;
}>;

export type TWidgetCollaborativeStatePort = Readonly<{
  open(args: Readonly<{
    identity: TWidgetCollaborativeStateIdentity;
    signal: AbortSignal;
    isCurrent(): boolean;
  }>): Promise<TWidgetCollaborativeStateSession>;
}>;

export type TWidgetCollaborativeStateDocumentPort = Readonly<{
  read(): unknown;
  change(mutator: (document: TMutableWidgetCollaborativeStateDocument) => void): void;
  subscribe(listener: () => void): () => void;
  dispose?(): void;
}>;

export type TWidgetRuntimeTransportPort = Readonly<{
  api: Readonly<{
    widget: Readonly<{
      runtime: Readonly<{
        load: TApi['widget']['runtime']['load'];
      }>;
    }>;
    function: Pick<TApi['function'], 'invoke' | 'get'>;
  }>;
}>;

export type TWidgetArtifactCodecPort = Readonly<{
  decodeBase64(value: string): Uint8Array;
  decodeUtf8(value: Uint8Array): string;
  digestSha256(value: Uint8Array): Promise<string>;
}>;

export type TVerifiedWidgetUiArtifactOutput = Readonly<{
  descriptor: TWidgetUiArtifactOutput;
  bytes: Uint8Array;
  text: string | null;
}>;

export type TVerifiedWidgetUiArtifact = Readonly<{
  digestSha256: string;
  envelope: TWidgetUiArtifactEnvelopeV1;
  outputs: readonly TVerifiedWidgetUiArtifactOutput[];
  retainedByteSize: number;
}>;

export type TWidgetServerFunctionClientRequest = Readonly<{
  functionName: string;
  input: unknown;
  idempotencyKey: string;
}>;

export type TWidgetFunctionHostBridge = Readonly<{
  identity: TWidgetRuntimeIdentity;
  createIdempotencyKey(): string;
  invoke<TOutput = unknown>(request: TWidgetServerFunctionClientRequest): Promise<TOutput>;
  dispose(): void;
}>;

export type TWidgetUiArtifactMountPort = Readonly<{
  mount(args: Readonly<{
    root: HTMLDivElement;
    identity: TWidgetRuntimeIdentity;
    artifact: TVerifiedWidgetUiArtifact;
    functionBridge: TWidgetFunctionHostBridge;
    collaborativeStateBridge: TWidgetCollaborativeStateSession | null;
    onFatal(error: unknown): void;
  }>): () => void;
}>;

export type TWidgetUiRuntimeRenderArgs = Readonly<{
  canvasId: string;
  element: TElement;
  root: HTMLDivElement;
}>;
