import type { IExactFunctionArtifactReader } from '@vibecanvas/function-runtime/local';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type { TWidgetServerArtifactCapability } from './WidgetServicePool';

type TWidgetFunctionArtifactReaderConfig = Readonly<{
  widgets: TWidgetServerArtifactCapability;
  capabilityTtlMs?: number;
  nowMs?: () => number;
}>;

/** Exact revision/contract/artifact verifier at the sandbox-read boundary. */
class WidgetFunctionArtifactReader implements IExactFunctionArtifactReader {
  readonly #widgets: TWidgetServerArtifactCapability;
  readonly #capabilityTtlMs: number;
  readonly #nowMs: () => number;

  constructor(config: TWidgetFunctionArtifactReaderConfig) {
    this.#widgets = config.widgets;
    this.#capabilityTtlMs = config.capabilityTtlMs ?? 30_000;
    this.#nowMs = config.nowMs ?? (() => Date.now());
    if (
      !Number.isInteger(this.#capabilityTtlMs)
      || this.#capabilityTtlMs < 1
      || this.#capabilityTtlMs > 5 * 60 * 1_000
    ) {
      throw new RangeError('Function artifact capability TTL is outside its host bound.');
    }
  }

  async readExactServerArtifact(
    tenant: TTenantContext,
    request: Readonly<{
      widgetDefinitionId: string;
      widgetRevisionId: string;
      artifactId: string;
      artifactDigestSha256: string;
      contractDigestSha256: string;
      runtimeAbi: string;
      subject: Parameters<IExactFunctionArtifactReader['readExactServerArtifact']>[1]['subject'];
    }>,
  ): Promise<Uint8Array> {
    const subject = request.subject;
    if (subject.kind === 'agent_preview') {
      return this.#readExactPreviewServerArtifact(tenant, request, subject);
    }
    const revision = await this.#widgets.getRevision(tenant, request.widgetRevisionId);
    const artifact = revision?.serverArtifact ?? null;
    if (
      revision === null
      || revision.definitionId !== request.widgetDefinitionId
      || revision.contractDigestSha256 !== request.contractDigestSha256
      || revision.manifest.server?.runtimeAbi !== request.runtimeAbi
      || artifact === null
      || artifact.id !== request.artifactId
      || artifact.digestSha256 !== request.artifactDigestSha256
      || artifact.kind !== 'server'
    ) {
      throw Object.assign(new Error('Pinned function artifact is unavailable.'), {
        code: 'FUNCTION_REVISION_NOT_AVAILABLE',
      });
    }
    const readCapability = await this.#widgets.issueServerExecutionArtifactReadCapability(
      tenant,
      {
        definitionId: request.widgetDefinitionId,
        revisionId: request.widgetRevisionId,
        artifactId: request.artifactId,
        artifactKind: 'server',
        digestSha256: request.artifactDigestSha256,
        expiresAtMs: this.#nowMs() + this.#capabilityTtlMs,
      },
    );
    const bytes = await this.#widgets.readArtifact(tenant, {
      artifactId: request.artifactId,
      readCapability,
      purpose: 'server_execution',
    });
    if (bytes === null) {
      throw Object.assign(new Error('Pinned function artifact is unavailable.'), {
        code: 'FUNCTION_REVISION_NOT_AVAILABLE',
      });
    }
    return bytes;
  }

  async #readExactPreviewServerArtifact(
    tenant: TTenantContext,
    request: Parameters<IExactFunctionArtifactReader['readExactServerArtifact']>[1],
    subject: Extract<
      Parameters<IExactFunctionArtifactReader['readExactServerArtifact']>[1]['subject'],
      { kind: 'agent_preview' }
    >,
  ): Promise<Uint8Array> {
    const nowMs = this.#nowMs();
    if (request.widgetRevisionId !== subject.previewRevisionId) {
      throw this.#unavailable();
    }
    const revision = await this.#widgets.getPreviewRevision(tenant, {
      previewId: subject.previewId,
      revisionId: subject.previewRevisionId,
      nowMs,
    });
    const artifact = revision?.serverArtifact ?? null;
    if (
      revision === null
      || revision.definitionId !== request.widgetDefinitionId
      || revision.contractDigestSha256 !== request.contractDigestSha256
      || revision.manifest.server?.runtimeAbi !== request.runtimeAbi
      || artifact === null
      || artifact.id !== request.artifactId
      || artifact.digestSha256 !== request.artifactDigestSha256
      || artifact.kind !== 'server'
    ) {
      throw this.#unavailable();
    }
    const readCapability = await this.#widgets.issueServerPreviewArtifactReadCapability(
      tenant,
      {
        previewId: subject.previewId,
        previewRevisionId: subject.previewRevisionId,
        artifactId: request.artifactId,
        artifactKind: 'server',
        digestSha256: request.artifactDigestSha256,
        expiresAtMs: nowMs + this.#capabilityTtlMs,
      },
    );
    const bytes = await this.#widgets.readArtifact(tenant, {
      artifactId: request.artifactId,
      readCapability,
      purpose: 'preview_server',
    });
    if (bytes === null) throw this.#unavailable();
    return bytes;
  }

  #unavailable(): Error {
    return Object.assign(new Error('Pinned function artifact is unavailable.'), {
      code: 'FUNCTION_REVISION_NOT_AVAILABLE',
    });
  }
}

export { WidgetFunctionArtifactReader };
export type { TWidgetFunctionArtifactReaderConfig };
