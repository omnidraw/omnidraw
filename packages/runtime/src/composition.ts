import type { TTenantContext } from '@vibecanvas/tenant-core'

/** Transport-neutral, tenant-qualified collaboration admission seam. */
export interface ICollaborationService {
  admitDocument(tenant: TTenantContext, documentId: string): Promise<boolean>
  releaseDocument(tenant: TTenantContext, documentId: string): Promise<void>
}

export type TScopedEventTopic =
  | Readonly<{ scope: 'organization'; name: string }>
  | Readonly<{ scope: 'canvas'; canvasId: string; name: string }>
  | Readonly<{ scope: 'session'; sessionId: string; name: string }>
  | Readonly<{ scope: 'invocation'; invocationId: string; name: string }>

export type TScopedEventRecord<TEvent = unknown> = Readonly<{
  eventId: string
  orgId: string
  topic: TScopedEventTopic
  sequence: number
  publishedAtMs: number
  event: TEvent
}>

/** Host-controlled event seam; implementations must derive scope from the tenant and topic. */
export interface IScopedEventBus<TEvent = unknown> {
  publish(
    tenant: TTenantContext,
    topic: TScopedEventTopic,
    event: TEvent,
  ): Promise<TScopedEventRecord<TEvent>>
  subscribe(
    tenant: TTenantContext,
    topic: TScopedEventTopic,
    options?: Readonly<{ afterSequence?: number }>,
  ): AsyncIterable<TScopedEventRecord<TEvent>>
}
