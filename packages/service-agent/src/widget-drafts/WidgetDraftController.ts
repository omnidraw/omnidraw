import { Actor } from '@vibecanvas/service-actor/Actor';
import { ActorResourceError } from '@vibecanvas/service-actor';
import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import { ZVibecanvasJson } from '@vibecanvas/service-actor/core/vibecanvasjson.zod';
import type { ITenantEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { execFile } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { txPublishWidgetDraft } from '../core/tx.publish-widget-draft';
import { txValidateWidgetFiles } from '../core/tx.validate-widget-files';
import { planImplicitResourceSelections, planSelectedResourceBindings, type TResourceBindingPlan } from '../tools/resource-bindings';
import type { TActorServiceReloader, TValidationResult, TWidgetDraftChange } from '../tools/types';
import type { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import { fnNormalizeWidgetName } from '../workspace/fn.names';
import type { TWidgetDraftWorkspaceEntry } from '../workspace/types';
import type {
  TWidgetDraftSummary,
  TWidgetPreviewCloseResult,
  TWidgetPreviewFailureReason,
  TWidgetPreviewReady,
  TWidgetPreviewResult,
  TWidgetPreviewSendResult,
  TWidgetPublishResult,
} from './types';

type TWidgetDraftControllerConfig = {
  configPath: string;
  workspace: WidgetWorkspace;
  eventPublisher: ITenantEventPublisherService;
  actorService?: TActorServiceReloader;
};

type TValidationCacheEntry = TValidationResult & { revision: string };

type TPreviewEntry = {
  actor: Actor;
  draftId: string;
  previewId: string;
  revision: string;
  manifest: TVibecanvasJson;
  sources: Record<string, string>;
  snapshot: Awaited<ReturnType<WidgetWorkspace['createPreviewSnapshot']>>;
  unlisten: () => void;
};

type TResourceBindingResult =
  | { ok: true; bindings: TResourceBindingPlan[] }
  | { ok: false; message: string };

function previewOwnerKey(draftId: string, previewId: string): string {
  return JSON.stringify([draftId, previewId]);
}

function previewDraftQueueKey(draftId: string): string {
  const normalized = fnNormalizeWidgetName(draftId);
  return normalized.ok ? normalized.caseKey : draftId.normalize('NFKC').toLocaleLowerCase('en-US');
}

async function waitForPreviewCleanups(operations: Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(operations);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) throw failure.reason;
}

export class WidgetDraftController {
  readonly #config: TWidgetDraftControllerConfig;
  readonly #validationByDraft = new Map<string, TValidationCacheEntry>();
  readonly #previews = new Map<string, TPreviewEntry>();
  readonly #previewDraftQueues = new Map<string, Promise<unknown>>();
  readonly #previewDraftOperations = new Set<Promise<unknown>>();
  readonly #previewBuildQueues = new Map<string, Promise<unknown>>();
  readonly #previewBuilds = new Set<Promise<unknown>>();
  #closing = false;

  constructor(config: TWidgetDraftControllerConfig) {
    this.#config = config;
  }

  async close(): Promise<void> {
    this.#closing = true;
    await Promise.allSettled([...this.#previewDraftOperations]);
    await Promise.allSettled([...this.#previewBuilds]);
    await waitForPreviewCleanups([...this.#previews.values()].map((preview) => {
      return this.#disposePreview(preview.draftId, preview.previewId);
    }));
  }

  async forget(name: string): Promise<void> {
    await this.withPreviewCleanup(name, async (cleanup) => cleanup());
  }

  async withPreviewCleanup<T>(name: string, operation: (cleanup: () => Promise<void>) => Promise<T>): Promise<T> {
    return this.#withPreviewCleanup([name], operation);
  }

  async withPreviewRenameCleanup<T>(name: string, nextName: string, operation: (cleanup: () => Promise<void>) => Promise<T>): Promise<T> {
    return this.#withPreviewCleanup([name, nextName], operation);
  }

  async #withPreviewCleanup<T>(names: string[], operation: (cleanup: () => Promise<void>) => Promise<T>): Promise<T> {
    if (this.#closing) throw new Error('Preview service is closing.');
    const draftIdsByQueueKey = new Map(names.map((draftId) => [previewDraftQueueKey(draftId), draftId]));
    const draftQueueKeys = [...draftIdsByQueueKey.keys()].sort();
    const draftIds = draftQueueKeys.map((queueKey) => draftIdsByQueueKey.get(queueKey)!);
    const draftQueueKeySet = new Set(draftQueueKeys);
    return this.#queueDraftPreviews(draftIds, async () => {
      let cleaned = false;
      const cleanup = async () => {
        if (cleaned) return;
        cleaned = true;
        for (const draftId of this.#validationByDraft.keys()) {
          if (draftQueueKeySet.has(previewDraftQueueKey(draftId))) this.#validationByDraft.delete(draftId);
        }
        const previews = [...this.#previews.values()].filter((preview) => {
          return draftQueueKeySet.has(previewDraftQueueKey(preview.draftId));
        });
        await waitForPreviewCleanups(previews.map((preview) => {
          return this.#queuePreviewBuild(preview.draftId, preview.previewId, () => {
            return this.#disposePreview(preview.draftId, preview.previewId);
          });
        }));
      };
      return operation(cleanup);
    });
  }

  async handleToolChange(change: TWidgetDraftChange): Promise<void> {
    const draft = await this.#config.workspace.getDraft(change.name);
    if (!draft) return;

    if (change.type === 'validated' && change.validation) {
      this.#validationByDraft.set(change.name, { ...change.validation, revision: draft.revision });
    } else {
      this.#validationByDraft.delete(change.name);
    }

    this.#config.eventPublisher.publishAgentEvent({
      kind: 'widget-draft',
      type: change.type,
      draftId: draft.name,
      revision: draft.revision,
    });
  }

  async list(): Promise<TWidgetDraftSummary[]> {
    const drafts = await this.#config.workspace.listDrafts();
    return Promise.all(drafts.map((draft) => this.#summary(draft)));
  }

  async get(name: string): Promise<TWidgetDraftSummary | null> {
    const draft = await this.#config.workspace.getDraft(name);
    return draft ? this.#summary(draft) : null;
  }

  async validate(name: string, expectedRevision?: string): Promise<TWidgetDraftSummary | null> {
    const draft = await this.#config.workspace.getDraft(name);
    if (!draft) return null;
    if (expectedRevision !== undefined && draft.revision !== expectedRevision) {
      return this.#summary(draft);
    }

    const validation = await txValidateWidgetFiles({ readdir, readFile, writeFile, rm, execFile, join, relative }, {
      cwd: draft.draftPath,
      sdkActorTypePath: join(this.#config.workspace.sdkPackagePath, 'src', 'actor.ts'),
    });
    const current = await this.#config.workspace.getDraft(name);
    if (!current) return null;
    if (current.revision === draft.revision) {
      this.#validationByDraft.set(name, {
        revision: current.revision,
        ok: validation.ok,
        errors: validation.errors.slice(0, 40),
        warnings: validation.warnings.slice(0, 40),
      });
      this.#config.eventPublisher.publishAgentEvent({
        kind: 'widget-draft',
        type: 'validated',
        draftId: current.name,
        revision: current.revision,
      });
    }
    return this.#summary(current);
  }

  async getPreview(name: string, previewId: string): Promise<TWidgetPreviewResult> {
    const draft = await this.#config.workspace.getDraft(name);
    if (!draft) return this.#previewFailure(name, 'not-found', `Widget draft '${name}' was not found.`);
    const preview = this.#previews.get(previewOwnerKey(draft.name, previewId));
    if (!preview) {
      return this.#previewFailure(draft.name, 'not-built', 'Preview has not been built for this draft.', draft);
    }
    return this.#previewReady(draft, preview);
  }

  async getPreviewCatalogState(name: string): Promise<import('./types').TWidgetPreviewCatalogState | null> {
    const draft = await this.#config.workspace.getDraft(name);
    if (!draft) return null;
    const ready = [...this.#previews.values()].find((preview) => {
      return preview.draftId === draft.name && preview.revision === draft.revision;
    });
    if (ready) return { status: 'ready', revision: ready.revision };
    const validation = this.#validationByDraft.get(draft.name);
    if (validation?.revision === draft.revision && !validation.ok) {
      return {
        status: 'failed',
        revision: draft.revision,
        message: 'Draft validation failed. Open the draft for diagnostics.',
      };
    }
    return { status: 'not-ready', revision: draft.revision, message: null };
  }

  async buildPreview(name: string, previewId: string, expectedRevision: string): Promise<TWidgetPreviewResult> {
    return this.#queueDraftPreview(name, async () => {
      const draft = await this.#config.workspace.getDraft(name);
      if (!draft) return this.#previewFailure(name, 'not-found', `Widget draft '${name}' was not found.`);
      if (this.#closing) {
        return this.#previewFailure(draft.name, 'build-failed', 'Preview service is closing.', draft, expectedRevision);
      }
      return this.#queuePreviewBuild(draft.name, previewId, () => this.#buildPreview(draft.name, previewId, expectedRevision));
    });
  }

  async #buildPreview(name: string, previewId: string, expectedRevision: string): Promise<TWidgetPreviewResult> {
    const draft = await this.#config.workspace.getDraft(name);
    if (!draft) return this.#previewFailure(name, 'not-found', `Widget draft '${name}' was not found.`);
    if (this.#closing) {
      return this.#previewFailure(draft.name, 'build-failed', 'Preview service is closing.', draft, expectedRevision);
    }
    if (draft.revision !== expectedRevision) {
      return this.#previewFailure(draft.name, 'stale-revision', 'The widget draft changed before Preview opened.', draft, expectedRevision);
    }
    await this.#disposePreview(draft.name, previewId);
    let ownedSnapshot: Awaited<ReturnType<WidgetWorkspace['createPreviewSnapshot']>> | undefined;
    try {
      ownedSnapshot = await this.#config.workspace.createPreviewSnapshot(draft.name, expectedRevision);
      const validation = await txValidateWidgetFiles({ readdir, readFile, writeFile, rm, execFile, join, relative }, {
        cwd: ownedSnapshot.rootPath,
        sdkActorTypePath: join(this.#config.workspace.sdkPackagePath, 'src', 'actor.ts'),
      });
      let current = await this.#config.workspace.getDraft(draft.name);
      if (!current) {
        await ownedSnapshot.dispose();
        return this.#previewFailure(draft.name, 'not-found', `Widget draft '${draft.name}' was not found.`);
      }
      if (current.revision === expectedRevision) {
        this.#validationByDraft.set(draft.name, {
          revision: expectedRevision,
          ok: validation.ok,
          errors: validation.errors.slice(0, 40),
          warnings: validation.warnings.slice(0, 40),
        });
        this.#config.eventPublisher.publishAgentEvent({
          kind: 'widget-draft',
          type: 'validated',
          draftId: current.name,
          revision: current.revision,
        });
      }
      if (!validation.ok) {
        await ownedSnapshot.dispose();
        return this.#previewFailure(
          draft.name,
          'validation-failed',
          'The widget draft must pass validation before it can be previewed.',
          current,
          expectedRevision,
          validation.errors,
        );
      }
      const manifestResult = await this.#readManifest(ownedSnapshot.rootPath);
      if (!manifestResult.ok) {
        await ownedSnapshot.dispose();
        return this.#previewFailure(draft.name, 'manifest-invalid', manifestResult.message, current, expectedRevision, [manifestResult.message]);
      }
      const sources = await this.#readWidgetSourceMap(ownedSnapshot.rootPath, manifestResult.manifest.widget.relWidgetDir);
      if (!sources['main.ts'] && !sources['main.js']) {
        await ownedSnapshot.dispose();
        return this.#previewFailure(
          draft.name,
          'source-missing',
          `Preview requires main.ts or main.js inside ${manifestResult.manifest.widget.relWidgetDir}.`,
          current,
          expectedRevision,
        );
      }
      const bindingPlan = await this.#resourceBindingPlan(manifestResult.manifest);
      if (!bindingPlan.ok) {
        await ownedSnapshot.dispose();
        return this.#previewFailure(draft.name, 'resource-binding-invalid', bindingPlan.message, current, expectedRevision, [bindingPlan.message]);
      }
      const directBindings = new Map(bindingPlan.bindings.map((binding) => [binding.slot, binding]));
      const resourceGateway = this.#config.actorService?.callWithDirectResourceBinding
        ? (call: Parameters<NonNullable<TActorServiceReloader['callWithDirectResourceBinding']>>[0]) => {
            const binding = directBindings.get(call.slot);
            const requirement = manifestResult.manifest.actor.resources?.[call.slot];
            if (!binding || !requirement) {
              throw new ActorResourceError('RESOURCE_NOT_BOUND', `Preview resource slot '${call.slot}' is not bound.`);
            }
            return this.#config.actorService!.callWithDirectResourceBinding!(call, {
              resourceId: binding.resource.id,
              requirement,
              scope: binding.scope,
            });
          }
        : undefined;
      const actor = new Actor({
        id: `preview:${previewOwnerKey(draft.name, previewId)}`,
        vsJson: manifestResult.manifest,
        rootDir: ownedSnapshot.rootPath,
        resourceGateway,
      });
      const preview: TPreviewEntry = {
        actor,
        draftId: draft.name,
        previewId,
        revision: expectedRevision,
        manifest: manifestResult.manifest,
        sources,
        snapshot: ownedSnapshot,
        unlisten: () => undefined,
      };
      preview.unlisten = actor.listen(() => {
        this.#config.eventPublisher.publishAgentEvent({
          kind: 'widget-preview',
          type: 'changed',
          draftId: draft.name,
          revision: preview.revision,
        });
      });
      this.#previews.set(previewOwnerKey(draft.name, previewId), preview);
      actor.start();
      this.#config.eventPublisher.publishAgentEvent({
        kind: 'widget-preview',
        type: 'catalog-changed',
        draftId: draft.name,
        revision: preview.revision,
      });
      await actor.waitUntilReady();
      current = await this.#config.workspace.getDraft(draft.name);
      if (!current) {
        await this.#disposePreview(draft.name, previewId);
        return this.#previewFailure(draft.name, 'not-found', `Widget draft '${draft.name}' was not found.`);
      }
      return this.#previewReady(current, preview);
    } catch (error) {
      await this.#disposePreview(draft.name, previewId);
      await ownedSnapshot?.dispose().catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      const latest = await this.#config.workspace.getDraft(draft.name);
      const stale = typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'WIDGET_DRAFT_REVISION_CHANGED';
      return this.#previewFailure(
        draft.name,
        stale ? 'stale-revision' : 'build-failed',
        message,
        latest ?? undefined,
        expectedRevision,
        [message],
      );
    }
  }

  async refreshPreview(name: string, previewId: string, expectedRevision: string): Promise<TWidgetPreviewResult> {
    return this.buildPreview(name, previewId, expectedRevision);
  }

  async resetPreview(name: string, previewId: string, expectedRevision: string): Promise<TWidgetPreviewResult> {
    return this.buildPreview(name, previewId, expectedRevision);
  }

  async closePreview(name: string, previewId: string, expectedRevision: string): Promise<TWidgetPreviewCloseResult> {
    return this.#queueDraftPreview(name, async () => {
      const draft = await this.#config.workspace.getDraft(name);
      const draftId = draft?.name ?? name;
      const result = { draftId, revision: expectedRevision };
      if (this.#closing) return { ...result, closed: false };
      return this.#queuePreviewBuild(draftId, previewId, async () => {
        const preview = this.#previews.get(previewOwnerKey(draftId, previewId));
        if (!preview || preview.revision !== expectedRevision) return { ...result, closed: false };
        await this.#disposePreview(draftId, previewId);
        return { ...result, closed: true };
      });
    });
  }

  async sendPreview(name: string, previewId: string, expectedRevision: string, messageName: string, payload: unknown): Promise<TWidgetPreviewSendResult> {
    return this.#queueDraftPreview(name, async () => {
      const draft = await this.#config.workspace.getDraft(name);
      if (!draft) return this.#previewFailure(name, 'not-found', `Widget draft '${name}' was not found.`);
      if (this.#closing) {
        return this.#previewFailure(draft.name, 'build-failed', 'Preview service is closing.', draft, expectedRevision);
      }
      return this.#queuePreviewBuild(draft.name, previewId, () => {
        return this.#sendPreview(draft.name, previewId, expectedRevision, messageName, payload);
      });
    });
  }

  async #sendPreview(name: string, previewId: string, expectedRevision: string, messageName: string, payload: unknown): Promise<TWidgetPreviewSendResult> {
    const draft = await this.#config.workspace.getDraft(name);
    if (!draft) return this.#previewFailure(name, 'not-found', `Widget draft '${name}' was not found.`);
    if (this.#closing) {
      return this.#previewFailure(draft.name, 'build-failed', 'Preview service is closing.', draft, expectedRevision);
    }
    const preview = this.#previews.get(previewOwnerKey(draft.name, previewId));
    if (!preview) return this.#previewFailure(draft.name, 'not-built', 'Preview has not been built for this draft.', draft);
    if (draft.revision !== expectedRevision || preview.revision !== expectedRevision) {
      return this.#previewFailure(draft.name, 'stale-revision', 'Refresh Preview before interacting with this changed draft.', draft, expectedRevision);
    }

    const messageId = preview.actor.inbox(messageName, payload);
    return {
      ready: true,
      revision: preview.revision,
      messageId,
      snapshot: this.#snapshot(preview.actor),
    };
  }

  async publish(name: string, expectedRevision: string): Promise<TWidgetPublishResult> {
    const draft = await this.#config.workspace.getDraft(name);
    if (!draft) return this.#publishFailure(name, 'not-found', `Widget draft '${name}' was not found.`);
    if (draft.revision !== expectedRevision) {
      return this.#publishFailure(draft.name, 'stale-revision', 'The widget draft changed before publication started.', draft.revision);
    }

    const summary = await this.validate(draft.name, expectedRevision);
    const current = await this.#config.workspace.getDraft(draft.name);
    if (!summary || !current) return this.#publishFailure(draft.name, 'not-found', `Widget draft '${draft.name}' was not found.`);
    if (current.revision !== expectedRevision) {
      return this.#publishFailure(draft.name, 'stale-revision', 'The widget draft changed while publication was validating.', current.revision);
    }
    if (summary.validation.status !== 'valid') {
      return this.#publishFailure(
        draft.name,
        'validation-failed',
        'The widget draft must pass validation before publication.',
        current.revision,
        summary.validation.errors,
        summary.validation.warnings,
      );
    }

    const manifestResult = await this.#readManifest(current.draftPath);
    if (!manifestResult.ok) {
      return this.#publishFailure(draft.name, 'validation-failed', manifestResult.message, current.revision, [manifestResult.message]);
    }
    if (manifestResult.manifest.name !== current.name) {
      return this.#publishFailure(
        draft.name,
        'validation-failed',
        `Published identity is '${current.name}', but vibecanvas.json declares '${manifestResult.manifest.name}'.`,
        current.revision,
      );
    }

    const bindingPlan = await this.#resourceBindingPlan(manifestResult.manifest);
    if (!bindingPlan.ok) {
      return this.#publishFailure(draft.name, 'publication-failed', bindingPlan.message, current.revision, [bindingPlan.message]);
    }
    if (this.#config.actorService && (
      !this.#config.actorService.transitionDefinitionPublication
      || !this.#config.actorService.listResourceBindingsForDefinition
    )) {
      return this.#publishFailure(
        draft.name,
        'publication-failed',
        'This host cannot coordinate definition, binding, and instance publication atomically.',
        current.revision,
      );
    }

    const finalWidgetsDir = join(this.#config.configPath, 'widgets');
    const installedPath = join(finalWidgetsDir, manifestResult.manifest.slug);
    const canonicalEntry = await stat(join(this.#config.workspace.publishedRoot, current.name)).catch(() => null);
    if (canonicalEntry) {
      const previousManifest = await this.#readManifest(join(this.#config.workspace.publishedRoot, current.name));
      if (!previousManifest.ok) {
        return this.#publishFailure(
          draft.name,
          'publication-failed',
          `The existing published manifest for '${current.name}' is invalid: ${previousManifest.message}`,
          current.revision,
        );
      }
      if (previousManifest.manifest.slug !== manifestResult.manifest.slug) {
        return this.#publishFailure(
          draft.name,
          'publication-failed',
          `Published slug '${previousManifest.manifest.slug}' is immutable. Create a new widget to publish as '${manifestResult.manifest.slug}'.`,
          current.revision,
        );
      }
    }
    if (await stat(installedPath).catch(() => null)) {
      const publishedManifest = await this.#readManifest(join(this.#config.workspace.publishedRoot, current.name));
      if (!publishedManifest.ok || publishedManifest.manifest.slug !== manifestResult.manifest.slug) {
        return this.#publishFailure(
          draft.name,
          'publication-failed',
          `A published widget already uses slug '${manifestResult.manifest.slug}'.`,
          current.revision,
        );
      }
    }
    let previousBindings: Awaited<ReturnType<NonNullable<TActorServiceReloader['listResourceBindingsForDefinition']>>> = [];
    try {
      previousBindings = await this.#config.actorService?.listResourceBindingsForDefinition?.(manifestResult.manifest.name) ?? [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.#publishFailure(draft.name, 'publication-failed', message, current.revision, [message]);
    }
    const previousBindingSet = previousBindings.map((binding) => ({
      slot: binding.slot_name,
      resourceId: binding.resource_id,
      scope: [
        ...(binding.allow_read ? ['read' as const] : []),
        ...(binding.allow_write ? ['write' as const] : []),
      ],
    }));
    const desiredBindingSet = bindingPlan.bindings.map((binding) => ({
      slot: binding.slot,
      resourceId: binding.resource.id,
      scope: binding.scope,
    }));
    let snapshot: Awaited<ReturnType<WidgetWorkspace['beginDraftPublish']>> | undefined;
    let transitionAttempted = false;
    let bindingReplacementCommitted = false;
    try {
      snapshot = await this.#config.workspace.beginDraftPublish(current.name, manifestResult.manifest.slug, expectedRevision);
      snapshot.markInstalledMutation();
      const result = await txPublishWidgetDraft({ readdir, readFile, writeFile, mkdir, rm, cp, execFile, join, relative, resolve, basename }, {
        cwd: snapshot.canonicalPath,
        finalWidgetsDir,
        actorService: undefined,
        sdkActorTypePath: join(this.#config.workspace.sdkPackagePath, 'src', 'actor.ts'),
      });
      if (!result.published) {
        await snapshot.rollback();
        return this.#publishFailure(
          draft.name,
          'validation-failed',
          result.validation.errors.join('\n') || 'Widget draft is invalid and was not published.',
          current.revision,
          result.validation.errors,
          result.validation.warnings,
        );
      }

      if (this.#config.actorService) {
        transitionAttempted = true;
        try {
          await this.#config.actorService.transitionDefinitionPublication!({
            definitionName: result.manifest.name,
            expectedBindings: previousBindingSet,
            bindings: desiredBindingSet,
            reloadInstances: snapshot.wasExisting,
          });
          bindingReplacementCommitted = true;
        } catch (transitionError) {
          bindingReplacementCommitted = Boolean(
            typeof transitionError === 'object'
            && transitionError !== null
            && (transitionError as { bindingReplacementCommitted?: unknown }).bindingReplacementCommitted,
          );
          throw transitionError;
        }
      }
      await snapshot.commit();

      this.#config.eventPublisher.publishAgentEvent({
        kind: 'widget-published',
        draftId: current.name,
        revision: current.revision,
        definitionName: result.manifest.name,
      });
      return {
        published: true,
        draftId: current.name,
        revision: current.revision,
        definitionName: result.manifest.name,
        manifest: result.manifest,
      };
    } catch (error) {
      const recoveryErrors: string[] = [];
      try {
        await snapshot?.rollback();
      } catch (recoveryError) {
        recoveryErrors.push(`filesystem rollback: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
      }
      if (transitionAttempted && this.#config.actorService?.transitionDefinitionPublication) {
        try {
          await this.#config.actorService.transitionDefinitionPublication({
            definitionName: manifestResult.manifest.name,
            expectedBindings: bindingReplacementCommitted ? desiredBindingSet : previousBindingSet,
            bindings: previousBindingSet,
            reloadInstances: snapshot?.wasExisting ?? false,
          });
        } catch (recoveryError) {
          recoveryErrors.push(`actor publication restore: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      const latest = await this.#config.workspace.getDraft(draft.name);
      if (recoveryErrors.length > 0) {
        const recoveryMessage = `Publication failed: ${message}. Recovery also failed: ${recoveryErrors.join('; ')}`;
        return this.#publishFailure(
          draft.name,
          'recovery-failed',
          recoveryMessage,
          latest?.revision,
          [`PUBLISH_RECOVERY_FAILED: ${recoveryErrors.join('; ')}`],
        );
      }
      const stale = latest !== null && latest.revision !== expectedRevision;
      return this.#publishFailure(
        draft.name,
        stale ? 'stale-revision' : /permission|authoriz/i.test(message) ? 'permission-failed' : 'publication-failed',
        message,
        latest?.revision,
      );
    }
  }

  async #summary(draft: TWidgetDraftWorkspaceEntry): Promise<TWidgetDraftSummary> {
    const manifest = await this.#readManifest(draft.draftPath);
    const validation = this.#validationByDraft.get(draft.name);
    const currentValidation = validation?.revision === draft.revision ? validation : undefined;
    const previewAvailable = manifest.ok && await this.#hasPreviewEntry(draft.draftPath, manifest.manifest.widget.relWidgetDir);

    return {
      draftId: draft.name,
      name: draft.name,
      displayName: manifest.ok ? manifest.manifest.name : draft.name,
      state: draft.published ? 'modified' : 'new',
      revision: draft.revision,
      updatedAt: draft.updatedAt,
      validation: currentValidation ? {
        status: currentValidation.ok ? 'valid' : 'invalid',
        errors: currentValidation.errors,
        warnings: currentValidation.warnings,
        validatedRevision: currentValidation.revision,
      } : {
        status: 'unknown',
        errors: [],
        warnings: [],
      },
      previewAvailable,
      publishReady: currentValidation?.ok === true,
    };
  }

  async #readManifest(root: string): Promise<{ ok: true; manifest: TVibecanvasJson } | { ok: false; message: string }> {
    try {
      const parsed = ZVibecanvasJson.safeParse(JSON.parse(await readFile(join(root, 'vibecanvas.json'), 'utf8')));
      if (!parsed.success) {
        return { ok: false, message: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') };
      }
      return { ok: true, manifest: parsed.data as TVibecanvasJson };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async #hasPreviewEntry(root: string, relWidgetDir: string): Promise<boolean> {
    const widgetRoot = resolve(root, relWidgetDir);
    if (!this.#isInside(root, widgetRoot)) return false;
    return Boolean(
      await stat(join(widgetRoot, 'main.ts')).catch(() => null)
      ?? await stat(join(widgetRoot, 'main.js')).catch(() => null),
    );
  }

  async #readWidgetSourceMap(root: string, relWidgetDir: string): Promise<Record<string, string>> {
    const widgetRoot = resolve(root, relWidgetDir);
    if (!this.#isInside(root, widgetRoot)) return {};
    const details = await stat(widgetRoot).catch(() => null);
    if (!details?.isDirectory()) return {};
    const sources: Record<string, string> = {};

    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const absolutePath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(absolutePath);
        } else if (entry.isFile()) {
          sources[relative(widgetRoot, absolutePath)] = await readFile(absolutePath, 'utf8');
        }
      }
    };
    await walk(widgetRoot);
    return sources;
  }

  #isInside(root: string, candidate: string): boolean {
    const rel = relative(resolve(root), candidate);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  }

  async #resourceBindingPlan(manifest: TVibecanvasJson): Promise<TResourceBindingResult> {
    const requirements = Object.keys(manifest.actor.resources ?? {});
    if (requirements.length === 0) return { ok: true, bindings: [] };
    const actorService = this.#config.actorService;
    if (!actorService?.listResources) return { ok: false, message: 'Resources cannot be discovered in this host.' };
    const available = await actorService.listResources({ status: 'ready' });
    const implicit = planImplicitResourceSelections(manifest, available.map((resource) => ({
      id: resource.id,
      kind: resource.kind,
      name: resource.name,
      status: resource.status,
    })));
    if (!implicit.ok) return implicit;
    return planSelectedResourceBindings(manifest, implicit.resources);
  }

  #previewReady(draft: TWidgetDraftWorkspaceEntry, preview: TPreviewEntry): TWidgetPreviewReady {
    return {
      ready: true,
      draftId: draft.name,
      name: preview.manifest.name,
      revision: preview.revision,
      currentRevision: draft.revision,
      stale: preview.revision !== draft.revision,
      manifest: preview.manifest,
      sources: preview.sources,
      snapshot: this.#snapshot(preview.actor),
      diagnostics: [],
    };
  }

  #previewFailure(
    draftId: string,
    reason: TWidgetPreviewFailureReason,
    message: string,
    draft?: TWidgetDraftWorkspaceEntry,
    revision?: string,
    diagnostics: string[] = [],
  ): Exclude<TWidgetPreviewResult, { ready: true }> {
    return {
      ready: false,
      draftId,
      revision,
      currentRevision: draft?.revision,
      reason,
      message,
      diagnostics,
    };
  }

  #publishFailure(
    draftId: string,
    reason: Exclude<TWidgetPublishResult, { published: true }>['reason'],
    message: string,
    currentRevision?: string,
    errors: string[] = [],
    warnings: string[] = [],
  ): Exclude<TWidgetPublishResult, { published: true }> {
    return { published: false, draftId, reason, message, currentRevision, errors, warnings };
  }

  #snapshot(actor: Actor): TWidgetPreviewReady['snapshot'] {
    return { state: actor.getState(), context: actor.getData() };
  }

  #queueDraftPreviews<T>(draftIds: string[], operation: () => Promise<T>): Promise<T> {
    const [draftId, ...rest] = draftIds;
    if (!draftId) return operation();
    return this.#queueDraftPreview(draftId, () => this.#queueDraftPreviews(rest, operation));
  }

  async #queueDraftPreview<T>(draftId: string, operation: () => Promise<T>): Promise<T> {
    const queueKey = previewDraftQueueKey(draftId);
    const previous = this.#previewDraftQueues.get(queueKey) ?? Promise.resolve();
    const running = previous.catch(() => undefined).then(operation);
    this.#previewDraftQueues.set(queueKey, running);
    this.#previewDraftOperations.add(running);
    try {
      return await running;
    } finally {
      this.#previewDraftOperations.delete(running);
      if (this.#previewDraftQueues.get(queueKey) === running) this.#previewDraftQueues.delete(queueKey);
    }
  }

  async #queuePreviewBuild<T>(draftId: string, previewId: string, operation: () => Promise<T>): Promise<T> {
    const ownerKey = previewOwnerKey(draftId, previewId);
    const previous = this.#previewBuildQueues.get(ownerKey) ?? Promise.resolve();
    const running = previous.catch(() => undefined).then(operation);
    this.#previewBuildQueues.set(ownerKey, running);
    this.#previewBuilds.add(running);
    try {
      return await running;
    } finally {
      this.#previewBuilds.delete(running);
      if (this.#previewBuildQueues.get(ownerKey) === running) this.#previewBuildQueues.delete(ownerKey);
    }
  }

  async #disposePreview(draftId: string, previewId: string): Promise<void> {
    const ownerKey = previewOwnerKey(draftId, previewId);
    const preview = this.#previews.get(ownerKey);
    if (!preview) return;
    preview.unlisten();
    if (!await preview.actor.closeAndWait()) {
      throw new Error(`Preview Actor '${draftId}' for owner '${previewId}' did not stop; its snapshot was retained.`);
    }
    await preview.snapshot.dispose();
    if (this.#previews.get(ownerKey) === preview) {
      this.#previews.delete(ownerKey);
      this.#config.eventPublisher.publishAgentEvent({
        kind: 'widget-preview',
        type: 'catalog-changed',
        draftId,
        revision: preview.revision,
      });
    }
  }
}
