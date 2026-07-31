import type { IResourceWritePermitAuthority } from '@omnidraw/function-runtime';
import {
  InvocationResourceGateway,
  type IInvocationResourceGatewayFactory,
  type IResourceWriteCapabilityIssuer,
} from '@omnidraw/function-runtime/local';
import type { ResourceServicePool } from './ResourceServicePool';
import type { TWidgetServerArtifactCapability } from './WidgetServicePool';

type TFunctionResourceGatewayFactoryConfig = Readonly<{
  resources: ResourceServicePool;
  widgets: TWidgetServerArtifactCapability;
  permits: IResourceWritePermitAuthority;
  writeCapabilities: IResourceWriteCapabilityIssuer;
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
    const previewTarget = request.envelope.subject.kind === 'widget_preview'
      ? await this.#config.widgets.resolvePreviewFunctionTarget(request.tenant, {
          previewId: request.envelope.subject.widgetInstanceId,
          revisionId: request.definition.widgetRevisionId,
          invocationId: request.envelope.id,
        })
      : null;
    const revision = request.envelope.subject.kind === 'widget_preview'
      ? previewTarget?.revision ?? null
      : await this.#config.widgets.getRevision(
          request.tenant,
          request.definition.widgetRevisionId,
        );
    if (
      revision === null
      || revision.definitionId !== request.definition.widgetDefinitionId
      || (
        'contractDigestSha256' in revision
          ? revision.contractDigestSha256
          : revision.previewContractDigestSha256
      ) !== request.definition.contractDigestSha256
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
      ...(previewTarget === null ? {} : { bindings: previewTarget.bindings }),
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
