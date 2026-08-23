/** @file Copy-only managed-draft import orchestration with explicit build trust. */

import {
  fnNormalizeWidgetImportSource,
  fnPlanWidgetImport,
  fnSelectWidgetImportRunner,
  fnValidateWidgetImportTree,
} from './fn.policy';
import type {
  TWidgetImportPlan,
  TWidgetImportPlanResult,
  TWidgetImportPorts,
  TWidgetImportRequest,
  TWidgetImportResult,
  TWidgetImportTreeValidation,
  TWidgetImportWriterLease,
} from './typed';

export class WidgetImportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'WidgetImportError';
    this.code = code;
  }
}

function requirePlan(result: TWidgetImportPlanResult): TWidgetImportPlan {
  if (result.ok) return result.plan;
  const suffix = result.collision === undefined ? '' : `: ${result.collision}`;
  throw new WidgetImportError(
    `WIDGET_IMPORT_${result.reason.toUpperCase()}`,
    `Widget import destination is not available (${result.reason})${suffix}`,
  );
}

function requireSafeTree(result: TWidgetImportTreeValidation): void {
  if (result.valid) return;
  const path = result.path === undefined ? '' : `: ${result.path}`;
  throw new WidgetImportError(
    `WIDGET_IMPORT_${result.reason.toUpperCase()}`,
    `Widget import tree is unsafe (${result.reason})${path}`,
  );
}

function requireDigest(value: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new WidgetImportError(
      'WIDGET_IMPORT_TREE_DIGEST_INVALID',
      'Managed widget import tree did not return a valid SHA-256 digest.',
    );
  }
  return value;
}

function requireManagedSlug(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new WidgetImportError(
      'WIDGET_IMPORT_MANIFEST_CHANGED',
      'Managed widget manifest slug changed while the checkout was copied.',
    );
  }
}

/**
 * Imports an external checkout by copying it into managed staging, validating
 * the copied tree, building through the selected injected runner, then moving
 * it to `drafts/<slug>` behind the root writer lease.
 */
export class WidgetImportService<TCheckout, TBuildResult> {
  readonly #ports: TWidgetImportPorts<TCheckout, TBuildResult>;

  constructor(ports: TWidgetImportPorts<TCheckout, TBuildResult>) {
    this.#ports = ports;
  }

  async import(
    request: TWidgetImportRequest,
  ): Promise<TWidgetImportResult<TBuildResult>> {
    const source = fnNormalizeWidgetImportSource(request.source);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (request.signal !== undefined) {
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) controller.abort();
    }
    const runner = fnSelectWidgetImportRunner({
      sourceKind: source.kind,
      localTrustPolicy: request.localTrustPolicy,
    });
    let checkout: TCheckout | null = null;
    let stagingPrepared = false;
    let plan: TWidgetImportPlan | null = null;
    let writerLease: TWidgetImportWriterLease | null = null;
    try {
      checkout = await this.#ports.acquireSource({ source, signal: controller.signal });
      const manifest = await this.#ports.inspectManifest({
        checkout,
        signal: controller.signal,
      });
      const operationId = this.#ports.createOperationId();
      plan = requirePlan(fnPlanWidgetImport({
        slug: manifest.slug,
        operationId,
        existingDraftDirectoryNames: await this.#ports.listDraftDirectoryNames({
          signal: controller.signal,
        }),
      }));

      // Every mutation beneath the managed root, including staging cleanup,
      // is serialized by the one root writer lease.
      writerLease = await this.#ports.acquireWriterLease({ signal: controller.signal });
      await this.#ports.prepareStaging({
        relativePath: plan.stagingRelativePath,
        expectedAbsent: true,
        signal: controller.signal,
      });
      stagingPrepared = true;
      await this.#ports.copyCheckout({
        checkout,
        destinationRelativePath: plan.stagingRelativePath,
        mode: plan.copyMode,
        signal: controller.signal,
      });
      const managedManifest = await this.#ports.inspectManagedManifest({
        relativePath: plan.stagingRelativePath,
        signal: controller.signal,
      });
      requireManagedSlug(managedManifest.slug, plan.slug);
      const capturedTree = await this.#ports.captureManagedTree({
        relativePath: plan.stagingRelativePath,
        signal: controller.signal,
      });
      requireSafeTree(fnValidateWidgetImportTree(capturedTree.entries));
      const sourceTreeDigestSha256 = requireDigest(capturedTree.digestSha256);

      const build = await this.#ports.build({
        sourceRelativePath: plan.stagingRelativePath,
        runner,
        expectedTreeDigestSha256: sourceTreeDigestSha256,
        signal: controller.signal,
      });

      const finalManifest = await this.#ports.inspectManagedManifest({
        relativePath: plan.stagingRelativePath,
        signal: controller.signal,
      });
      requireManagedSlug(finalManifest.slug, plan.slug);
      const finalTree = await this.#ports.captureManagedTree({
        relativePath: plan.stagingRelativePath,
        signal: controller.signal,
      });
      requireSafeTree(fnValidateWidgetImportTree(finalTree.entries));
      if (requireDigest(finalTree.digestSha256) !== sourceTreeDigestSha256) {
        throw new WidgetImportError(
          'WIDGET_IMPORT_STAGING_CHANGED',
          'Managed widget import bytes changed after the validated build.',
        );
      }
      const finalPlan = requirePlan(fnPlanWidgetImport({
        slug: plan.slug,
        operationId,
        existingDraftDirectoryNames: await this.#ports.listDraftDirectoryNames({
          signal: controller.signal,
        }),
      }));
      await this.#ports.promoteStaging({
        stagingRelativePath: finalPlan.stagingRelativePath,
        draftRelativePath: finalPlan.draftRelativePath,
        expectedDraftAbsent: true,
        expectedTreeDigestSha256: sourceTreeDigestSha256,
        signal: controller.signal,
      });
      stagingPrepared = false;
      return Object.freeze({
        slug: finalPlan.slug,
        draftRelativePath: finalPlan.draftRelativePath,
        sourceTreeDigestSha256,
        runner,
        build,
      });
    } finally {
      try {
        if (stagingPrepared && plan !== null) {
          await this.#ports.removeManagedPath({
            relativePath: plan.stagingRelativePath,
          });
        }
      } finally {
        try {
          if (writerLease !== null) await writerLease.release();
        } finally {
          try {
            if (checkout !== null) await this.#ports.releaseSource({ checkout });
          } finally {
            if (request.signal !== undefined) {
              request.signal.removeEventListener('abort', abort);
            }
          }
        }
      }
    }
  }
}

export type * from './typed';
export {
  fnNormalizeWidgetImportSource,
  fnPlanWidgetImport,
  fnSelectWidgetImportRunner,
  fnValidateWidgetImportTree,
} from './fn.policy';
