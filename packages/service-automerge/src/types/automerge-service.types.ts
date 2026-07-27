import type { TTenantContext } from '@vibecanvas/tenant-core';

export type TAutomergeElementEvent<TElement> = Readonly<{
  tenantContext: TTenantContext;
  canvasDocId: string;
  automergeUrl: string;
  element: TElement;
}>;

export type TAutomergeTenantMetrics = Readonly<{
  activeDocuments: number;
  connectedPeers: number;
  admittedPeerDocuments: number;
  pendingWrites: number;
  pendingBytes: number;
  evictedDocuments: number;
  deniedDocuments: number;
}>;

export type TAutomergeServiceOptions = Readonly<{
  maxActiveDocuments?: number;
  documentIdleMs?: number;
  lifecycleSweepMs?: number;
}>;
