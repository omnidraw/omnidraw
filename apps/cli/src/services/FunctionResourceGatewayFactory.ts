import type { Database } from '@tursodatabase/database';
import type { IResourceWritePermitAuthority } from '@vibecanvas/function-runtime';
import {
  InvocationResourceGateway,
  type IInvocationResourceGatewayFactory,
  type IResourceWriteCapabilityIssuer,
} from '@vibecanvas/function-runtime/local';
import type { ResourceServicePool } from './ResourceServicePool';
import type { TWidgetServerArtifactCapability } from './WidgetServicePool';

type TFunctionResourceGatewayFactoryConfig = Readonly<{
  database: Database;
  resources: ResourceServicePool;
  widgets: TWidgetServerArtifactCapability;
  permits: IResourceWritePermitAuthority;
  writeCapabilities: IResourceWriteCapabilityIssuer;
  nowMs?: () => number;
}>;

/** Resolves the exact immutable revision manifest before exposing a logical gateway. */
class FunctionResourceGatewayFactory implements IInvocationResourceGatewayFactory {
  readonly #config: TFunctionResourceGatewayFactoryConfig;

  constructor(config: TFunctionResourceGatewayFactoryConfig) {
    this.#config = config;
  }

  async createInvocationResourceGateway(
    request: Parameters<IInvocationResourceGatewayFactory['createInvocationResourceGateway']>[0],
  ): Promise<InvocationResourceGateway> {
    const subject = request.envelope.subject;
    if (subject.kind === 'agent_preview') {
      return this.#createPreviewResourceGateway(request, subject);
    }
    const revision = await this.#config.widgets.getRevision(request.tenant, request.definition.widgetRevisionId);
    if (
      revision === null
      || revision.definitionId !== request.definition.widgetDefinitionId
      || revision.contractDigestSha256 !== request.definition.contractDigestSha256
      || revision.serverArtifact?.id !== request.definition.serverArtifactId
      || revision.serverArtifact.digestSha256 !== request.definition.artifactDigestSha256
      || revision.manifest.server?.runtimeAbi !== request.definition.runtimeAbi
    ) {
      throw Object.assign(new Error('Pinned function resource revision is unavailable.'), {
        code: 'FUNCTION_REVISION_NOT_AVAILABLE',
      });
    }
    const service = await this.#config.resources.forTenant(request.tenant);
    const access = service.createFunctionResourceGateway(request.tenant, {
      definitionId: request.definition.widgetDefinitionId,
      revisionId: request.definition.widgetRevisionId,
      requirements: revision.manifest.resources ?? [],
    });
    return new InvocationResourceGateway({
      tenant: request.tenant,
      definition: request.definition,
      envelope: request.envelope,
      attempt: request.attempt,
      getLease: request.getLease,
      gateway: access.gateway,
      bindings: access.bindings,
      permits: this.#config.permits,
      writeCapabilities: this.#config.writeCapabilities,
    });
  }

  async #createPreviewResourceGateway(
    request: Parameters<IInvocationResourceGatewayFactory['createInvocationResourceGateway']>[0],
    subject: Extract<
      Parameters<IInvocationResourceGatewayFactory['createInvocationResourceGateway']>[0]['envelope']['subject'],
      { kind: 'agent_preview' }
    >,
  ): Promise<InvocationResourceGateway> {
    const revision = await this.#config.widgets.getPreviewRevision(request.tenant, {
      previewId: subject.previewId,
      revisionId: subject.previewRevisionId,
      nowMs: this.#config.nowMs?.() ?? Date.now(),
    });
    if (
      revision === null
      || revision.id !== request.definition.widgetRevisionId
      || revision.definitionId !== request.definition.widgetDefinitionId
      || revision.contractDigestSha256 !== request.definition.contractDigestSha256
      || revision.serverArtifact?.id !== request.definition.serverArtifactId
      || revision.serverArtifact.digestSha256 !== request.definition.artifactDigestSha256
      || revision.manifest.server?.runtimeAbi !== request.definition.runtimeAbi
    ) {
      throw Object.assign(new Error('Pinned preview function resource revision is unavailable.'), {
        code: 'FUNCTION_REVISION_NOT_AVAILABLE',
      });
    }
    const rows = await (await this.#config.database.prepare(`
      SELECT slot_name, resource_id, resource_kind, is_required,
        allow_read, allow_write
      FROM agent_preview_resource_bindings
      WHERE org_id = ? AND preview_id = ? AND revision_id = ?
      ORDER BY slot_name ASC
    `)).all(
      request.tenant.orgId,
      subject.previewId,
      subject.previewRevisionId,
    ) as Record<string, unknown>[];
    const service = await this.#config.resources.forTenant(request.tenant);
    const access = service.createPreviewFunctionResourceGateway(request.tenant, {
      requirements: revision.manifest.resources ?? [],
      bindings: rows.map((row) => ({
        slot: String(row.slot_name),
        resourceId: String(row.resource_id),
        kind: String(row.resource_kind) as 'kv' | 'secretStore' | 'db',
        required: row.is_required === 1 || row.is_required === true,
        allowRead: row.allow_read === 1 || row.allow_read === true,
        allowWrite: row.allow_write === 1 || row.allow_write === true,
        definitionId: revision.definitionId,
        revisionId: revision.id,
      })),
    });
    return new InvocationResourceGateway({
      tenant: request.tenant,
      definition: request.definition,
      envelope: request.envelope,
      attempt: request.attempt,
      getLease: request.getLease,
      gateway: access.gateway,
      bindings: access.bindings,
      permits: this.#config.permits,
      writeCapabilities: this.#config.writeCapabilities,
    });
  }
}

export { FunctionResourceGatewayFactory };
export type { TFunctionResourceGatewayFactoryConfig };
