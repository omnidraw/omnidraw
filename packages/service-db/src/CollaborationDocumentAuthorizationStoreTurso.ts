import type { Database } from '@tursodatabase/database';
import type { TTenantContext } from '@vibecanvas/tenant-core';

type TAuthorizationRow = Readonly<{
  authorized: unknown;
}>;

/** Exact, tenant-qualified authorization for canvas and widget-state documents. */
export class CollaborationDocumentAuthorizationStoreTurso {
  constructor(private readonly database: Database) {}

  async authorizeDocument(
    tenant: TTenantContext,
    automergeUrl: string,
  ): Promise<boolean> {
    const row = await (await this.database.prepare(`
      SELECT (
        EXISTS (
        SELECT 1
        FROM collaboration_documents AS document
        INNER JOIN canvas_members AS member
          ON member.org_id = document.org_id
          AND member.canvas_id = document.canvas_id
          AND member.account_id = ?
        WHERE document.org_id = ?
          AND document.automerge_url = ?
          AND document.canvas_id IS NOT NULL
          AND (? IS NULL OR document.canvas_id = ?)
        )
        OR EXISTS (
        SELECT 1
        FROM collaboration_documents AS document
        INNER JOIN widget_instances AS instance
          ON instance.org_id = document.org_id
          AND instance.id = document.widget_instance_id
          AND instance.status = 'active'
        INNER JOIN canvas_members AS member
          ON member.org_id = instance.org_id
          AND member.canvas_id = instance.canvas_id
          AND member.account_id = ?
        INNER JOIN collaboration_documents AS canvas_document
          ON canvas_document.org_id = instance.org_id
          AND canvas_document.canvas_id = instance.canvas_id
          AND canvas_document.widget_instance_id IS NULL
        INNER JOIN widget_instance_projection_heads AS projection_head
          ON projection_head.org_id = canvas_document.org_id
          AND projection_head.canvas_id = canvas_document.canvas_id
          AND projection_head.source_sequence = canvas_document.content_version
        WHERE document.org_id = ?
          AND document.automerge_url = ?
          AND document.widget_instance_id IS NOT NULL
          AND (? IS NULL OR instance.canvas_id = ?)
        )
      ) AS authorized
    `)).get(
      tenant.accountId,
      tenant.orgId,
      automergeUrl,
      tenant.canvasId ?? null,
      tenant.canvasId ?? null,
      tenant.accountId,
      tenant.orgId,
      automergeUrl,
      tenant.canvasId ?? null,
      tenant.canvasId ?? null,
    ) as TAuthorizationRow | undefined;
    return Number(row?.authorized) === 1;
  }
}
