import type { Database } from '@tursodatabase/database';
import type { IService, IStoppableService } from '@vibecanvas/runtime';
import { WidgetControlStoreTurso } from '@vibecanvas/service-db/WidgetControlStoreTurso';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  IWidgetArtifactGarbageCollector,
  IWidgetBrowserUiArtifactReadCapabilityIssuer,
  IWidgetArtifactReader,
  IWidgetPublicationService,
  IWidgetServerExecutionArtifactReadCapabilityIssuer,
  IWidgetServerFunctionDescriptorExtractor,
  TWidgetActiveRevisionCasResult,
  TWidgetArtifactDescriptor,
  TWidgetArtifactGcRequest,
  TWidgetArtifactGcResult,
  TWidgetArtifactReadCapability,
  TWidgetArtifactReadCapabilityIssueRequest,
  TWidgetArtifactReadRequest,
  TWidgetPublishRequest,
  TWidgetPublishResult,
  TWidgetRevisionDescriptor,
  TWidgetRevisionId,
  TWidgetRollbackInput,
} from '@vibecanvas/widget-contract';
import {
  LocalWidgetArtifactStore,
  WidgetArtifactBuilderBun,
  WidgetArtifactGarbageCollector,
  WidgetArtifactOperationLane,
  WidgetArtifactReadAuthority,
  WidgetArtifactService,
  WidgetPublicationService,
  WidgetSourceSnapshot,
  type TCapturedWidgetSourceSnapshot,
} from '@vibecanvas/widget-contract/local';

type TWidgetServicePlacement = Readonly<Pick<
  TTenantContext,
  'orgId' | 'cellId' | 'placementEpoch'
>>;

type TWidgetServiceConfig = Readonly<{
  placement: TWidgetServicePlacement;
  database: Database;
  artifactsRoot: string;
  buildTempRoot: string;
  builderIdentity: string;
  artifactReadSecret: Uint8Array;
  artifactReadMaximumTtlMs: number;
  functionDescriptorExtractor: IWidgetServerFunctionDescriptorExtractor;
  resolveTrustedPackageImport: (specifier: string) => string;
}>;

type TWidgetSourceCaptureArgs = Readonly<{
  id?: string;
  createdAtMs?: number;
  expectedDigestSha256?: string;
}>;

/** Organization-placement owner for actor-free v2 widget artifacts and revisions. */
class WidgetService implements
  IService,
  IStoppableService,
  IWidgetPublicationService,
  IWidgetArtifactReader,
  IWidgetBrowserUiArtifactReadCapabilityIssuer,
  IWidgetServerExecutionArtifactReadCapabilityIssuer,
  IWidgetArtifactGarbageCollector {
  readonly name = 'widget-service';
  readonly #placement: TWidgetServicePlacement;
  readonly #sourceSnapshot: WidgetSourceSnapshot;
  readonly #publication: WidgetPublicationService;
  readonly #artifacts: WidgetArtifactService;
  readonly #garbageCollector: WidgetArtifactGarbageCollector;

  constructor(config: TWidgetServiceConfig) {
    this.#placement = Object.freeze({ ...config.placement });
    this.#sourceSnapshot = new WidgetSourceSnapshot();

    const controlStore = new WidgetControlStoreTurso(config.database);
    const blobs = new LocalWidgetArtifactStore({
      orgId: config.placement.orgId,
      artifactsRoot: config.artifactsRoot,
    });
    const operationLane = new WidgetArtifactOperationLane();
    const readAuthority = new WidgetArtifactReadAuthority({
      secret: config.artifactReadSecret,
      maximumTtlMs: config.artifactReadMaximumTtlMs,
    });
    this.#artifacts = new WidgetArtifactService({
      controlStore,
      blobs,
      capabilityIssuer: readAuthority,
      capabilityVerifier: readAuthority,
    });
    this.#publication = new WidgetPublicationService({
      builder: new WidgetArtifactBuilderBun({
        tempRoot: config.buildTempRoot,
        builderIdentity: config.builderIdentity,
        snapshotService: this.#sourceSnapshot,
        functionDescriptorExtractor: config.functionDescriptorExtractor,
        resolveTrustedPackageImport: config.resolveTrustedPackageImport,
      }),
      artifacts: this.#artifacts,
      controlStore,
      mutationCoordinator: controlStore,
      operationLane,
    });
    this.#garbageCollector = new WidgetArtifactGarbageCollector({
      controlStore,
      mutationCoordinator: controlStore,
      blobs,
      operationLane,
    });
  }

  captureSource(
    tenant: TTenantContext,
    sourceRoot: string,
    args: TWidgetSourceCaptureArgs = {},
  ): Promise<TCapturedWidgetSourceSnapshot> {
    this.#assertPlacement(tenant);
    return this.#sourceSnapshot.capture(sourceRoot, args);
  }

  publish(
    tenant: TTenantContext,
    request: TWidgetPublishRequest,
  ): Promise<TWidgetPublishResult> {
    this.#assertPlacement(tenant);
    return this.#publication.publish(tenant, request);
  }

  rollback(
    tenant: TTenantContext,
    request: TWidgetRollbackInput,
  ): Promise<TWidgetActiveRevisionCasResult> {
    this.#assertPlacement(tenant);
    return this.#publication.rollback(tenant, request);
  }

  getRevision(
    tenant: TTenantContext,
    revisionId: TWidgetRevisionId,
  ): Promise<TWidgetRevisionDescriptor | null> {
    this.#assertPlacement(tenant);
    return this.#publication.getRevision(tenant, revisionId);
  }

  getActiveRevision(
    tenant: TTenantContext,
    definitionId: string,
  ): Promise<TWidgetRevisionDescriptor | null> {
    this.#assertPlacement(tenant);
    return this.#publication.getActiveRevision(tenant, definitionId);
  }

  issueBrowserUiArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetArtifactReadCapabilityIssueRequest,
  ): Promise<TWidgetArtifactReadCapability> {
    this.#assertPlacement(tenant);
    return this.#artifacts.issueBrowserUiArtifactReadCapability(tenant, request);
  }

  issueServerExecutionArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetArtifactReadCapabilityIssueRequest,
  ): Promise<TWidgetArtifactReadCapability> {
    this.#assertPlacement(tenant);
    return this.#artifacts.issueServerExecutionArtifactReadCapability(tenant, request);
  }

  getArtifact(
    tenant: TTenantContext,
    request: TWidgetArtifactReadRequest,
  ): Promise<TWidgetArtifactDescriptor | null> {
    this.#assertPlacement(tenant);
    return this.#artifacts.getArtifact(tenant, request);
  }

  readArtifact(
    tenant: TTenantContext,
    request: TWidgetArtifactReadRequest,
  ): Promise<Uint8Array | null> {
    this.#assertPlacement(tenant);
    return this.#artifacts.readArtifact(tenant, request);
  }

  collect(
    tenant: TTenantContext,
    request: TWidgetArtifactGcRequest,
  ): Promise<TWidgetArtifactGcResult> {
    this.#assertPlacement(tenant);
    return this.#garbageCollector.collect(tenant, request);
  }

  stop(): void {
    // The owner holds immutable paths and stateless adapters only. The method
    // participates in pool lifecycle so future adapters can add cleanup safely.
  }

  #assertPlacement(tenant: TTenantContext): void {
    if (
      tenant.orgId !== this.#placement.orgId
      || tenant.cellId !== this.#placement.cellId
      || tenant.placementEpoch !== this.#placement.placementEpoch
    ) {
      throw Object.assign(new Error('Widget service placement does not own this request.'), {
        code: 'WIDGET_PLACEMENT_MISMATCH',
      });
    }
  }
}

export { WidgetService };
export type {
  TWidgetServiceConfig,
  TWidgetServicePlacement,
  TWidgetSourceCaptureArgs,
};
