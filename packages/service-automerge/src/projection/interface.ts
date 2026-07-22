import type { TTenantContext } from '@vibecanvas/tenant-core';

export type TWidgetInstanceProjectionElement = Readonly<{
  id: string;
  data: Readonly<{
    type: string;
    definitionId?: unknown;
    revisionId?: unknown;
    instanceId?: unknown;
    stateDocumentId?: unknown;
  }>;
}>;

export type TWidgetInstanceProjectionSource = Readonly<{
  /** Durable collaboration change sequence, never the canvas document's embedded id. */
  canvasId: string;
  sourceSequence: number;
  elements: Readonly<Record<string, TWidgetInstanceProjectionElement>>;
}>;

export type TWidgetInstanceProjectionRecord = Readonly<{
  instanceId: string;
  elementId: string;
  definitionId: string;
  revisionId: string;
  stateDocumentId: string | null;
}>;

export type TWidgetInstanceProjectionSnapshot = Readonly<{
  canvasId: string;
  sourceSequence: number;
  projectedAtMs: number;
  instances: readonly TWidgetInstanceProjectionRecord[];
}>;

export type TWidgetInstanceProjectionBatchRequest = Readonly<{
  snapshots: readonly TWidgetInstanceProjectionSnapshot[];
}>;

export type TWidgetInstanceProjectionApplyResult = Readonly<{
  canvasId: string;
  sourceSequence: number;
  projectedAtMs: number;
  status: 'applied' | 'replayed' | 'stale';
  activeCount: number;
  archivedCount: number;
}>;

export interface IWidgetInstanceMetadataProjectionStore {
  applyProjectionBatch(
    tenant: TTenantContext,
    request: TWidgetInstanceProjectionBatchRequest,
  ): Promise<readonly TWidgetInstanceProjectionApplyResult[]>;
}

export type TWidgetInstanceMetadataProjectorPortal = Readonly<{
  store: IWidgetInstanceMetadataProjectionStore;
  nowMs: () => number;
}>;

export type TWidgetInstanceMetadataProjectorDiagnostics = Readonly<{
  accepting: boolean;
  pendingCanvasCount: number;
  retainedCanvasCount: number;
  retainedCanvasCapacity: number;
  inFlightSnapshotCount: number;
  appliedSnapshotCount: number;
  replayedSnapshotCount: number;
  staleSnapshotCount: number;
  coalescedSnapshotCount: number;
  batchCount: number;
  rejectedSnapshotCount: number;
  quarantinedCanvasCount: number;
  quarantinedCanvases: readonly Readonly<{
    orgId: string;
    canvasId: string;
    sourceSequence: number | null;
    reason: string;
  }>[];
  lastRejection: string | null;
  lastFailure: string | null;
}>;

export type TWidgetInstanceProjectionEnqueueResult =
  | Readonly<{ status: 'queued'; canvasId: string; sourceSequence: number }>
  | Readonly<{ status: 'quarantined'; canvasId: string; sourceSequence: number | null; reason: string }>
  | Readonly<{ status: 'rejected'; canvasId: string; sourceSequence: number | null; reason: string }>;
