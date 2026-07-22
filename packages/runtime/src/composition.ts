import type { TTenantContext } from '@vibecanvas/tenant-core'

/** Transport-neutral, tenant-qualified collaboration admission seam. */
export interface ICollaborationService {
  admitDocument(tenant: TTenantContext, documentId: string): Promise<boolean>
  releaseDocument(tenant: TTenantContext, documentId: string): Promise<void>
}
