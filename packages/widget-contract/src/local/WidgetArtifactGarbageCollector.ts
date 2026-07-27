import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  IWidgetArtifactGarbageCollector,
  IWidgetArtifactMutationCoordinator,
  IWidgetControlStore,
  TWidgetArtifactGcRequest,
  TWidgetArtifactGcResult,
} from '..';
import { LocalWidgetArtifactStore } from './LocalWidgetArtifactStore';
import { WidgetArtifactOperationLane } from './WidgetArtifactOperationLane';

export type TWidgetArtifactGarbageCollectorConfig = Readonly<{
  controlStore: IWidgetControlStore;
  mutationCoordinator: IWidgetArtifactMutationCoordinator;
  blobs: LocalWidgetArtifactStore;
  operationLane: WidgetArtifactOperationLane;
}>;

/** Mark/grace/recheck/sweep collector for metadata rows and crash-orphan blobs. */
export class WidgetArtifactGarbageCollector implements IWidgetArtifactGarbageCollector {
  constructor(readonly config: TWidgetArtifactGarbageCollectorConfig) {}

  collect(
    tenant: TTenantContext,
    request: TWidgetArtifactGcRequest,
  ): Promise<TWidgetArtifactGcResult> {
    if (tenant.orgId !== this.config.blobs.config.orgId) {
      throw new Error('Widget artifact GC tenant does not own the configured blob root.');
    }
    return this.config.operationLane.run(async () => {
      const reconciled = await this.config.mutationCoordinator.runArtifactMutation(
        tenant,
        async () => {
          await this.config.controlStore.pruneInactiveRevisions(tenant, {
            nowMs: request.nowMs,
            inactiveBeforeMs: Math.max(0, request.nowMs - request.gracePeriodMs),
            limit: request.limit,
          });
          return this.config.controlStore.reconcileArtifactRetention(tenant, {
            nowMs: request.nowMs,
            gracePeriodMs: request.gracePeriodMs,
            limit: request.limit,
          });
        },
      );
      const candidates = await this.config.controlStore.listArtifactGcCandidates(tenant, {
        nowMs: request.nowMs,
        limit: request.limit,
      });

      let deleted = 0;
      let restored = 0;
      for (const candidate of candidates) {
        // This transaction must commit independently. A durable `deleting`
        // row is the tombstone that prevents a publisher from making the
        // digest live while a later filesystem unlink is in flight.
        const claim = await this.config.mutationCoordinator.runArtifactMutation(
          tenant,
          () => this.config.controlStore.claimArtifactDeletion(tenant, {
            artifactId: candidate.id,
            expectedDigestSha256: candidate.digestSha256,
            expectedRetainUntilMs: candidate.retainUntilMs ?? 0,
            nowMs: request.nowMs,
          }),
        );
        if (!claim) continue;

        // Metadata finalization and physical unlink share a second mutation
        // transaction. If unlink/fsync or commit fails, rollback can restore
        // only the already-committed tombstone, never a live reference.
        const completion = await this.config.mutationCoordinator.runArtifactMutation(
          tenant,
          async () => {
            const result = await this.config.controlStore.completeArtifactDeletion(tenant, {
              artifactId: claim.id,
              expectedDigestSha256: claim.digestSha256,
            });
            if (!result.completed) {
              const didRestore = await this.config.controlStore.restoreArtifactRetention(tenant, {
                artifactId: claim.id,
                expectedDigestSha256: claim.digestSha256,
              });
              return Object.freeze({ deleted: false, restored: didRestore });
            }
            if (result.deleteBlob) await this.config.blobs.deleteArtifact(claim);
            return Object.freeze({ deleted: true, restored: false });
          },
        );
        if (completion.deleted) deleted += 1;
        if (completion.restored) restored += 1;
      }

      // Blob fsync can precede rename or the metadata transaction. Only aged
      // crash candidates are eligible; fresh final and temp files remain owned
      // by a potentially in-flight writer. Each recheck/unlink is fenced from
      // a concurrent publication that could make the digest live.
      const orphanCutoffMs = Math.max(0, request.nowMs - request.gracePeriodMs);
      for (const candidate of await this.config.blobs.listBlobCandidates()) {
        if (deleted >= request.limit) break;
        if (candidate.modifiedAtMs > orphanCutoffMs) continue;
        const removed = await this.config.mutationCoordinator.runArtifactMutation(
          tenant,
          async () => {
            if (
              candidate.form === 'final'
              && await this.config.controlStore.isArtifactDigestReferenced(tenant, {
                digestSha256: candidate.digestSha256,
              })
            ) {
              return false;
            }
            return this.config.blobs.deleteBlobCandidate(candidate, {
              notModifiedAfterMs: orphanCutoffMs,
            });
          },
        );
        if (removed) deleted += 1;
      }

      return Object.freeze({
        reconciledPinned: reconciled.pinnedArtifactIds.length,
        reconciledEligible: reconciled.eligibleArtifactIds.length,
        deleted,
        restored,
      });
    });
  }
}
