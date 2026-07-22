import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  ZWidgetBrowserFunctionDescriptors,
  ZWidgetManifestV2,
  type TWidgetManifestV2,
  type TWidgetPreviewBuildResult,
  type TWidgetSourceSnapshot,
} from '@vibecanvas/widget-contract';
import { fnDecodeWidgetUiArtifactEnvelope } from '@vibecanvas/widget-contract/browser';
import type { ITenantEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { txValidateWidgetFiles } from '../core/tx.validate-widget-files';
import type { TValidationResult } from '../core/types';
import type { TWidgetDraftChange } from '../tools/types';
import type { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import type { TWidgetDraftWorkspaceEntry } from '../workspace/types';
import type {
  IAgentAuthoringStore,
  TAgentAuthoringDraftDescriptor,
  TWidgetAuthoringCapability,
  TWidgetDraftSummary,
  TWidgetPreviewCatalogState,
  TWidgetPreviewFailureReason,
  TWidgetPreviewReady,
  TWidgetPreviewResult,
  TWidgetPublishResult,
  TWidgetResourceBindingResolver,
} from './types';

const WIDGET_UI_ARTIFACT_MAX_BYTES = 16 * 1_024 * 1_024;

type TValidationCacheEntry = TValidationResult & { revision: string };

type TCapturedDraft = Readonly<{
  workspace: TWidgetDraftWorkspaceEntry;
  rootPath: string;
  snapshot: TWidgetSourceSnapshot;
}>;

export type TWidgetDraftControllerConfig = Readonly<{
  tenant: TTenantContext;
  workspace: WidgetWorkspace;
  eventPublisher: ITenantEventPublisherService;
  authoringStore: IAgentAuthoringStore;
  widgets: TWidgetAuthoringCapability;
  resolveResourceBindings: TWidgetResourceBindingResolver;
  createId: () => string;
  nowMs: () => number;
  builderIdentity: string;
}>;

function controllerError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function errorCode(error: unknown): string {
  return error !== null && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCurrentRevision(error: unknown): string | null {
  if (error === null || typeof error !== 'object' || !('currentRevision' in error)) return null;
  const currentRevision = error.currentRevision;
  return typeof currentRevision === 'string' ? currentRevision : null;
}

/** Durable draft/publication orchestration with stateless UI-only preview builds. */
export class WidgetDraftController {
  readonly #config: TWidgetDraftControllerConfig;
  readonly #validationByDraft = new Map<string, TValidationCacheEntry>();
  readonly #operations = new Map<string, Promise<unknown>>();
  #closing = false;

  constructor(config: TWidgetDraftControllerConfig) {
    this.#config = config;
    if (!config.builderIdentity.trim()) {
      throw new TypeError('Widget authoring builder identity is required.');
    }
  }

  async close(): Promise<void> {
    this.#closing = true;
    await Promise.allSettled(this.#operations.values());
  }

  async handleToolChange(change: TWidgetDraftChange): Promise<TWidgetDraftSummary | null> {
    const durable = await this.#config.authoringStore.getDraftByName(
      this.#config.tenant,
      change.name,
    );
    return this.#queue(durable ? this.#draftOperationKey(durable.id) : `name:${change.name}`, async () => {
      const workspace = await this.#config.workspace.getDraft(change.name);
      if (!workspace) return null;
      return this.#withCapturedWorkspace(workspace, async (captured) => {
        const draft = await this.#ensureDurableDraft(captured, change.chatId);
        if (!draft) return null;
        const synced = await this.#compareAndSetDraft(draft, captured.snapshot.digestSha256, {
          status: 'editing',
          lastError: null,
        });
        if (!synced) return null;

        if (change.type === 'validated') {
          await this.#validateCaptured(synced, captured);
          const validated = await this.#activeDraft(synced.id);
          return validated ? this.#summary(validated, captured.workspace) : null;
        }
        this.#validationByDraft.delete(synced.id);
        this.#publishDraftEvent(change.type, synced.id, captured.snapshot.digestSha256);
        return this.#summary(synced, captured.workspace);
      });
    });
  }

  async list(): Promise<TWidgetDraftSummary[]> {
    const drafts = await this.#config.authoringStore.listDrafts(this.#config.tenant);
    const summaries = await Promise.all(drafts
      .filter((draft) => draft.status !== 'discarded')
      .map((draft) => this.#refreshAndSummarize(draft)));
    return summaries
      .filter((summary): summary is TWidgetDraftSummary => summary !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async get(draftId: string): Promise<TWidgetDraftSummary | null> {
    const draft = await this.#config.authoringStore.getDraft(this.#config.tenant, draftId);
    return draft && draft.status !== 'discarded' ? this.#refreshAndSummarize(draft) : null;
  }

  async getByName(name: string): Promise<TWidgetDraftSummary | null> {
    const draft = await this.#config.authoringStore.getDraftByName(this.#config.tenant, name);
    return draft && draft.status !== 'discarded' ? this.#refreshAndSummarize(draft) : null;
  }

  /** Reconstructs an editable draft from one exact durable publication source. */
  async materializePublishedDraft(request: Readonly<{
    name: string;
    definitionId: string;
    publishedRevisionId: string;
    snapshot: TWidgetSourceSnapshot;
  }>): Promise<TWidgetDraftSummary> {
    const initial = await this.#config.authoringStore.getDraftByName(
      this.#config.tenant,
      request.name,
    );
    return this.#queue(initial ? this.#draftOperationKey(initial.id) : `name:${request.name}`, async () => {
      const materialized = await this.#config.workspace.materializeDraftFromSnapshot(
        request.name,
        request.snapshot,
        {
          definitionId: request.definitionId,
          publishedRevisionId: request.publishedRevisionId,
        },
      );
      const existing = await this.#config.authoringStore.getDraftByName(
        this.#config.tenant,
        request.name,
      );
      if (existing && existing.status !== 'discarded') {
        if (
          (materialized.pending && !this.#matchesPublicationSeed(existing, request))
          || (!materialized.pending && existing.definitionId !== request.definitionId)
        ) {
          if (materialized.pending) await materialized.rollback().catch(() => false);
          throw controllerError(
            'AGENT_AUTHORING_INTEGRITY_FAILED',
            'Widget source conflicts with its active durable publication identity.',
          );
        }
        if (materialized.pending) {
          await materialized.commitSeed(async () => existing);
        }
        await this.#mountDurableDraft(existing);
        return this.#summary(existing, materialized.draft);
      }
      if (!materialized.pending) {
        throw controllerError(
          'AGENT_AUTHORING_INTEGRITY_FAILED',
          'Untracked widget source cannot be claimed as an immutable publication draft.',
        );
      }

      const externalSessionKey = this.#managementChatExternalKey(request.definitionId);
      await this.#config.workspace.ensureChat(externalSessionKey);
      let chat = await this.#config.authoringStore.getChatByExternalSessionKey(
        this.#config.tenant,
        externalSessionKey,
      );
      if (!chat) {
        try {
          chat = await this.#config.authoringStore.createChat(this.#config.tenant, {
            id: this.#config.createId(),
            canvasId: this.#config.tenant.canvasId ?? null,
            externalSessionKey,
            name: request.name,
            workspaceRelativePath: relative(
              this.#config.workspace.agentRoot,
              this.#config.workspace.getChatRoot(externalSessionKey),
            ),
            historyRelativePath: relative(
              this.#config.workspace.agentRoot,
              this.#config.workspace.getChatHistoryRoot(externalSessionKey),
            ),
            nowMs: this.#now(),
          });
        } catch {
          chat = await this.#config.authoringStore.getChatByExternalSessionKey(
            this.#config.tenant,
            externalSessionKey,
          );
        }
      }
      if (!chat) throw controllerError('AGENT_CHAT_CREATE_FAILED', 'Widget management chat could not be created.');

      let seeded: TAgentAuthoringDraftDescriptor;
      try {
        seeded = await materialized.commitSeed(() => (
          this.#config.authoringStore.createDraft(this.#config.tenant, {
            id: this.#config.createId(),
            chatId: chat.id,
            name: request.name,
            sourceRelativePath: this.#sourceRelativePath(materialized.draft),
            publicationSeed: {
              definitionId: request.definitionId,
              publishedRevisionId: request.publishedRevisionId,
              sourceDigestSha256: request.snapshot.digestSha256,
            },
            nowMs: this.#now(),
          })
        ));
      } catch (error) {
        const winner = await this.#config.authoringStore.getDraftByName(
          this.#config.tenant,
          request.name,
        );
        if (!winner || winner.status === 'discarded') {
          await materialized.rollback().catch(() => false);
          throw error;
        }
        if (!this.#matchesPublicationSeed(winner, request)) {
          await materialized.rollback().catch(() => false);
          throw controllerError(
            'AGENT_AUTHORING_INTEGRITY_FAILED',
            'Newly materialized widget source conflicts with its active durable draft.',
          );
        }
        await materialized.commitSeed(async () => winner);
        await this.#mountDurableDraft(winner);
        return this.#summary(winner, materialized.draft);
      }
      if (
        seeded.definitionId !== request.definitionId
        || seeded.publishedRevisionId !== request.publishedRevisionId
        || seeded.sourceDigestSha256 !== request.snapshot.digestSha256
        || seeded.status !== 'published'
      ) {
        throw controllerError(
          'AGENT_AUTHORING_INTEGRITY_FAILED',
          'Materialized widget draft does not match its durable publication seed.',
        );
      }
      await this.#mountDurableDraft(seeded);
      this.#validationByDraft.delete(seeded.id);
      this.#publishDraftEvent('created', seeded.id, request.snapshot.digestSha256);
      return this.#summary(seeded, materialized.draft);
    });
  }

  /** Resolves a public immutable source revision to the current private workspace CAS token. */
  async getWorkspaceRevision(name: string, expectedSourceRevision: string): Promise<string> {
    const draft = await this.#config.authoringStore.getDraftByName(this.#config.tenant, name);
    if (!draft || draft.status === 'discarded') {
      throw controllerError('WIDGET_DRAFT_NOT_FOUND', `Widget draft '${name}' was not found.`);
    }
    const workspace = await this.#config.workspace.getDraft(name);
    if (!workspace) throw controllerError('WIDGET_DRAFT_NOT_FOUND', `Widget draft '${name}' was not found.`);
    return this.#withCapturedWorkspace(workspace, async (captured) => {
      if (captured.snapshot.digestSha256 !== expectedSourceRevision) {
        throw controllerError(
          'STALE_REVISION',
          `STALE_REVISION: Widget draft '${name}' changed before the edit was saved.`,
        );
      }
      return workspace.revision;
    });
  }

  async validate(draftId: string, expectedRevision?: string): Promise<TWidgetDraftSummary | null> {
    return this.#queue(`draft:${draftId}`, async () => {
      const draft = await this.#activeDraft(draftId);
      if (!draft) return null;
      const workspace = await this.#config.workspace.getDraft(draft.name);
      if (!workspace) return null;

      return this.#withCapturedWorkspace(workspace, async (captured) => {
        const currentRevision = captured.snapshot.digestSha256;
        const synced = await this.#compareAndSetDraft(draft, currentRevision, { status: 'editing' });
        if (!synced) return this.get(draftId);
        if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
          return this.#summary(synced, captured.workspace);
        }
        await this.#validateCaptured(synced, captured);
        const current = await this.#activeDraft(draftId);
        return current ? this.#summary(current, captured.workspace) : null;
      });
    });
  }

  async getPreviewCatalogState(name: string): Promise<TWidgetPreviewCatalogState | null> {
    const draft = await this.#config.authoringStore.getDraftByName(this.#config.tenant, name);
    if (!draft || draft.status === 'discarded') return null;
    const currentRevision = draft.sourceDigestSha256 ?? '';
    const validation = this.#validationForDraft(draft, currentRevision);
    if (validation.status === 'invalid') {
      return {
        status: 'failed',
        revision: currentRevision,
        message: 'Draft validation failed. Open the draft for diagnostics.',
      };
    }
    return validation.status === 'valid'
      ? { status: 'ready', revision: currentRevision }
      : { status: 'not-ready', revision: currentRevision, message: null };
  }

  async buildPreview(draftId: string): Promise<TWidgetPreviewResult> {
    return this.#queue(`draft:${draftId}`, async () => {
      if (this.#closing) {
        return this.#previewFailure(draftId, 'build-failed', 'Preview service is closing.');
      }
      const draft = await this.#activeDraft(draftId);
      if (!draft) return this.#previewFailure(draftId, 'not-found', 'Widget draft was not found.');
      const workspace = await this.#config.workspace.getDraft(draft.name);
      if (!workspace) return this.#previewFailure(draft.id, 'not-found', 'Widget draft source was not found.');

      return this.#withCapturedWorkspace(workspace, async (captured) => {
        const currentRevision = captured.snapshot.digestSha256;
        const synced = await this.#compareAndSetDraft(draft, currentRevision, { status: 'editing' });
        if (!synced) {
          return this.#previewFailure(draft.id, 'build-failed', 'The widget draft changed before Preview opened.');
        }

        const validation = await this.#validateCaptured(synced, captured);
        if (!validation.ok) {
          return this.#previewFailure(draft.id, 'validation-failed', 'The widget draft must pass validation before it can be previewed.', {
            revision: currentRevision,
            diagnostics: validation.errors,
          });
        }
        const manifest = await this.#readManifest(captured.rootPath);
        if (!manifest.ok) {
          return this.#previewFailure(draft.id, 'manifest-invalid', manifest.message, {
            revision: currentRevision,
            diagnostics: [manifest.message],
          });
        }
        if (manifest.manifest.name !== draft.name) {
          const message = `Draft identity is '${draft.name}', but vibecanvas.json declares '${manifest.manifest.name}'.`;
          return this.#previewFailure(draft.id, 'manifest-invalid', message, {
            revision: currentRevision,
            diagnostics: [message],
          });
        }

        try {
          const fenced = await this.#config.workspace.withDraftRevisionFence(
            draft.name,
            captured.workspace.revision,
            async () => {
              const commitDraft = await this.#activeDraft(draft.id);
              if (!commitDraft) {
                return {
                  status: 'failed' as const,
                  result: this.#previewFailure(
                    draft.id,
                    'not-found',
                    'Widget draft was discarded before Preview opened.',
                    { revision: currentRevision },
                  ),
                };
              }
              if (commitDraft.sourceDigestSha256 !== currentRevision) {
                return {
                  status: 'failed' as const,
                  result: this.#previewFailure(
                    draft.id,
                    'build-failed',
                    'The widget draft changed before Preview opened.',
                    {
                      revision: commitDraft.sourceDigestSha256 ?? currentRevision,
                    },
                  ),
                };
              }

              const result = await this.#config.widgets.buildPreview(this.#config.tenant, {
                draftId: draft.id,
                definitionId: draft.definitionId,
                draftRevisionSha256: currentRevision,
                snapshot: captured.snapshot,
                manifest: manifest.manifest,
                builderIdentity: this.#config.builderIdentity,
              });
              return { status: 'committed' as const, result };
            },
          );
          if (fenced.status === 'failed') return fenced.result;
          const ready = this.#previewReady(fenced.result);

          // Preview bytes are complete; event delivery remains best-effort.
          try {
            this.#config.eventPublisher.publishAgentEvent({
              kind: 'widget-preview',
              type: 'catalog-changed',
              draftId: draft.id,
              revision: currentRevision,
            });
          } catch {}
          return ready;
        } catch (error) {
          const message = errorMessage(error);
          const code = errorCode(error);
          const failureCurrentRevision = code === 'WIDGET_DRAFT_REVISION_CHANGED'
            ? await this.#currentWorkspaceSourceRevision(
              draft.name,
              errorCurrentRevision(error) ?? currentRevision,
            )
            : currentRevision;
          return this.#previewFailure(draft.id, 'build-failed', message, {
            revision: failureCurrentRevision,
            diagnostics: [message],
          });
        }
      });
    });
  }

  async publish(draftId: string, expectedRevision: string): Promise<TWidgetPublishResult> {
    return this.#queue(`draft:${draftId}`, async () => {
      const draft = await this.#activeDraft(draftId);
      if (!draft) return this.#publishFailure(draftId, 'not-found', 'Widget draft was not found.');
      const workspace = await this.#config.workspace.getDraft(draft.name);
      if (!workspace) return this.#publishFailure(draft.id, 'not-found', 'Widget draft source was not found.');

      return this.#withCapturedWorkspace(workspace, async (captured) => {
        const currentRevision = captured.snapshot.digestSha256;
        const synced = await this.#compareAndSetDraft(draft, currentRevision, { status: 'editing' });
        if (!synced || expectedRevision !== currentRevision) {
          return this.#publishFailure(
            draft.id,
            'stale-revision',
            'The widget draft changed before publication started.',
            currentRevision,
          );
        }
        const validation = await this.#validateCaptured(synced, captured);
        if (!validation.ok) {
          return this.#publishFailure(
            draft.id,
            'validation-failed',
            'The widget draft must pass validation before publication.',
            currentRevision,
            validation.errors,
            validation.warnings,
          );
        }
        const manifest = await this.#readManifest(captured.rootPath);
        if (!manifest.ok || manifest.manifest.name !== draft.name) {
          const message = manifest.ok
            ? `Draft identity is '${draft.name}', but vibecanvas.json declares '${manifest.manifest.name}'.`
            : manifest.message;
          return this.#publishFailure(draft.id, 'validation-failed', message, currentRevision, [message]);
        }
        let bindings;
        try {
          bindings = await this.#config.resolveResourceBindings(this.#config.tenant, {
            draft: synced,
            manifest: manifest.manifest,
          });
        } catch (error) {
          const message = errorMessage(error);
          return this.#publishFailure(draft.id, 'resource-binding-invalid', message, currentRevision, [message]);
        }

        let publishedRevisionId: string;
        try {
          const fenced = await this.#config.workspace.withDraftRevisionFence(
            draft.name,
            captured.workspace.revision,
            async () => {
              const commitDraft = await this.#activeDraft(draft.id);
              if (!commitDraft) {
                return {
                  status: 'failed' as const,
                  result: this.#publishFailure(
                    draft.id,
                    'not-found',
                    'Widget draft was discarded before publication committed.',
                  ),
                };
              }
              if (commitDraft.sourceDigestSha256 !== currentRevision) {
                return {
                  status: 'failed' as const,
                  result: this.#publishFailure(
                    draft.id,
                    'stale-revision',
                    'The widget draft changed before publication committed.',
                    commitDraft.sourceDigestSha256 ?? currentRevision,
                  ),
                };
              }

              const result = await this.#config.widgets.publish(this.#config.tenant, {
                definitionId: draft.definitionId,
                expectedActiveRevisionId: commitDraft.publishedRevisionId,
                revisionId: this.#config.createId(),
                snapshot: captured.snapshot,
                manifest: manifest.manifest,
                bindings,
                builderIdentity: this.#config.builderIdentity,
                nowMs: this.#now(),
              });
              if (result.status === 'conflict') {
                const idempotentRevisionId = await this.#idempotentPublishedRevisionId(
                  draft,
                  currentRevision,
                  result.currentActiveRevisionId,
                );
                if (!idempotentRevisionId) {
                  return {
                    status: 'failed' as const,
                    result: this.#publishFailure(
                      draft.id,
                      'publication-conflict',
                      'Published widget changed before this exact draft revision could be committed.',
                      currentRevision,
                    ),
                  };
                }
                return { status: 'committed' as const, publishedRevisionId: idempotentRevisionId };
              }
              return { status: 'committed' as const, publishedRevisionId: result.revision.id };
            },
          );
          if (fenced.status === 'failed') return fenced.result;
          publishedRevisionId = fenced.publishedRevisionId;
        } catch (error) {
          const message = errorMessage(error);
          if (errorCode(error) === 'WIDGET_DRAFT_REVISION_CHANGED') {
            return this.#publishFailure(
              draft.id,
              'stale-revision',
              'The widget draft changed before publication committed.',
              await this.#currentWorkspaceSourceRevision(
                draft.name,
                errorCurrentRevision(error) ?? currentRevision,
              ),
            );
          }
          return this.#publishFailure(
            draft.id,
            'publication-failed',
            message,
            currentRevision,
            [message],
          );
        }

        // Publication is committed from here onward. Reconciliation and event
        // delivery are best-effort and must never turn a committed response
        // into a false publication failure.
        try {
          await this.#recordPublishedRevision(draft, currentRevision, publishedRevisionId);
        } catch {}
        try {
          this.#config.eventPublisher.publishAgentEvent({
            kind: 'widget-published',
            draftId: draft.id,
            revision: currentRevision,
            definitionName: manifest.manifest.name,
          });
        } catch {}
        return {
          published: true,
          draftId: draft.id,
          definitionId: draft.definitionId,
          revision: currentRevision,
          publishedRevisionId,
          manifest: manifest.manifest,
        };
      });
    });
  }

  async forget(name: string): Promise<void> {
    const initial = await this.#config.authoringStore.getDraftByName(this.#config.tenant, name);
    if (!initial) return;
    await this.#queue(this.#draftOperationKey(initial.id), async () => {
      const draft = await this.#config.authoringStore.getDraft(this.#config.tenant, initial.id);
      if (!draft || draft.status === 'discarded' || draft.name !== name) return;
      const result = await this.#config.authoringStore.discardDraft(this.#config.tenant, {
        draftId: draft.id,
        expectedSourceDigestSha256: draft.sourceDigestSha256,
        nowMs: this.#now(),
      });
      if (result.status !== 'updated') {
        throw controllerError('AGENT_DRAFT_CONFLICT', 'Widget draft changed before it could be discarded.');
      }
      this.#validationByDraft.delete(draft.id);
    });
  }

  async withDraftDeletion<T>(
    name: string,
    operation: (
      cleanup: () => Promise<void>,
      discardBeforeRemoval: () => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    const initial = await this.#config.authoringStore.getDraftByName(this.#config.tenant, name);
    return this.#queue(initial ? this.#draftOperationKey(initial.id) : `name:${name}`, async () => {
      const current = initial
        ? await this.#config.authoringStore.getDraft(this.#config.tenant, initial.id)
        : null;
      const draft = current?.status !== 'discarded' && current?.name === name ? current : null;
      const cleanup = async () => {};
      let discarded = false;
      const discardBeforeRemoval = async () => {
        if (discarded) return;
        await cleanup();
        if (!draft) {
          discarded = true;
          return;
        }
        const discardResult = await this.#config.authoringStore.discardDraft(this.#config.tenant, {
          draftId: draft.id,
          expectedSourceDigestSha256: draft.sourceDigestSha256,
          nowMs: this.#now(),
        });
        if (discardResult.status !== 'updated') {
          throw controllerError('AGENT_DRAFT_CONFLICT', 'Widget draft changed before deletion was recorded.');
        }
        this.#validationByDraft.delete(draft.id);
        discarded = true;
      };
      return operation(cleanup, discardBeforeRemoval);
    });
  }

  async withDraftRename<T>(
    name: string,
    nextName: string,
    operation: (
      cleanup: () => Promise<void>,
      coordinateCommit: (commit: () => Promise<void>) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    const [initial, target] = await Promise.all([
      this.#config.authoringStore.getDraftByName(this.#config.tenant, name),
      this.#config.authoringStore.getDraftByName(this.#config.tenant, nextName),
    ]);
    const keys = initial
      ? [this.#draftOperationKey(initial.id), ...(target ? [this.#draftOperationKey(target.id)] : [`name:${nextName}`])]
      : [`name:${name}`, ...(target ? [this.#draftOperationKey(target.id)] : [`name:${nextName}`])];
    return this.#queueMany(keys, async () => {
      const current = initial
        ? await this.#config.authoringStore.getDraft(this.#config.tenant, initial.id)
        : null;
      const draft = current?.status !== 'discarded' && current?.name === name ? current : null;
      const cleanup = async () => {};
      let coordinated = false;
      const coordinateCommit = async (commit: () => Promise<void>) => {
        await cleanup();
        await commit();
        if (draft && name !== nextName) {
          const beforeCapture = await this.#config.workspace.getDraft(nextName);
          if (!beforeCapture) {
            throw controllerError('AGENT_DRAFT_RENAME_FAILED', 'Renamed widget source was not found.');
          }
          const snapshot = await this.#config.widgets.captureSource(
            this.#config.tenant,
            beforeCapture.draftPath,
            { id: this.#config.createId(), createdAtMs: this.#now() },
          );
          const afterCapture = await this.#config.workspace.getDraft(nextName);
          if (!afterCapture || afterCapture.revision !== beforeCapture.revision) {
            throw controllerError(
              'WIDGET_DRAFT_REVISION_CHANGED',
              'Widget draft changed while its rename was being committed.',
            );
          }
          const renamed = await this.#config.authoringStore.renameDraft(this.#config.tenant, {
            draftId: draft.id,
            expectedName: name,
            nextName,
            nextSourceRelativePath: this.#sourceRelativePath(afterCapture),
            expectedSourceDigestSha256: draft.sourceDigestSha256,
            nextSourceDigestSha256: snapshot.digestSha256,
            nowMs: this.#now(),
          });
          if (renamed.status !== 'updated') {
            throw controllerError('AGENT_DRAFT_CONFLICT', 'Widget draft changed before rename was recorded.');
          }
          this.#validationByDraft.delete(draft.id);
        }
        coordinated = true;
      };
      const result = await operation(cleanup, coordinateCommit);
      if (!coordinated) {
        throw controllerError(
          'AGENT_DRAFT_RENAME_FAILED',
          'Widget draft rename did not use its coordinated commit boundary.',
        );
      }
      return result;
    });
  }

  async #refreshAndSummarize(
    draft: TAgentAuthoringDraftDescriptor,
  ): Promise<TWidgetDraftSummary | null> {
    const workspace = await this.#config.workspace.getDraft(draft.name);
    if (!workspace) return null;
    return this.#summary(draft, workspace);
  }

  async #summary(
    draft: TAgentAuthoringDraftDescriptor,
    workspace: TWidgetDraftWorkspaceEntry,
  ): Promise<TWidgetDraftSummary> {
    const manifest = await this.#readManifest(workspace.draftPath);
    const revision = draft.sourceDigestSha256 ?? workspace.revision;
    const validation = this.#validationForDraft(draft, revision);
    const previewAvailable = manifest.ok && await this.#hasUiEntry(
      workspace.draftPath,
      manifest.manifest.ui.entry,
    );
    return {
      draftId: draft.id,
      definitionId: draft.definitionId,
      chatId: draft.chatId,
      name: draft.name,
      displayName: manifest.ok ? manifest.manifest.name : draft.name,
      state: draft.status === 'published'
        ? 'published'
        : draft.publishedRevisionId ? 'modified' : 'new',
      revision,
      publishedRevisionId: draft.publishedRevisionId,
      updatedAt: new Date(draft.updatedAtMs).toISOString(),
      validation,
      previewAvailable,
      publishReady: validation.status === 'valid',
    };
  }

  async #validateCaptured(
    draft: TAgentAuthoringDraftDescriptor,
    captured: TCapturedDraft,
  ): Promise<TValidationResult> {
    const validation = await txValidateWidgetFiles(
      { readdir, readFile, writeFile, rm, execFile, join, relative },
      { cwd: captured.rootPath },
    );
    const manifest = await this.#readManifest(captured.rootPath);
    if (manifest.ok && manifest.manifest.name !== draft.name) {
      validation.ok = false;
      validation.errors.push(
        `Draft identity is '${draft.name}', but vibecanvas.json declares '${manifest.manifest.name}'.`,
      );
    }
    if (validation.ok && manifest.ok) {
      try {
        const trusted = await this.#config.widgets.validateBuild(this.#config.tenant, {
          snapshot: captured.snapshot,
          manifest: manifest.manifest,
        });
        if (!trusted.valid) {
          validation.ok = false;
          validation.errors.push(...trusted.diagnostics.slice(0, 40));
        }
      } catch (error) {
        validation.ok = false;
        validation.errors.push(errorMessage(error));
      }
    }
    const errors = validation.errors.slice(0, 40);
    const warnings = validation.warnings.slice(0, 40);
    this.#validationByDraft.set(draft.id, {
      revision: captured.snapshot.digestSha256,
      ok: validation.ok,
      errors,
      warnings,
    });
    const transitioned = await this.#config.authoringStore.compareAndSetDraft(this.#config.tenant, {
      draftId: draft.id,
      expectedSourceDigestSha256: captured.snapshot.digestSha256,
      nextSourceDigestSha256: captured.snapshot.digestSha256,
      nextStatus: validation.ok ? 'ready' : 'error',
      lastError: validation.ok ? null : this.#validationError({ ok: false, errors, warnings }),
      nowMs: this.#now(),
    });
    if (transitioned.status !== 'updated') {
      throw controllerError('AGENT_DRAFT_CONFLICT', 'Widget draft changed while validation was finishing.');
    }
    this.#publishDraftEvent('validated', draft.id, captured.snapshot.digestSha256);
    return { ok: validation.ok, errors, warnings };
  }

  #previewReady(preview: TWidgetPreviewBuildResult): TWidgetPreviewResult {
    try {
      const uiArtifact = preview.uiArtifact;
      if (
        uiArtifact.bytes.byteLength < 1
        || uiArtifact.bytes.byteLength > WIDGET_UI_ARTIFACT_MAX_BYTES
      ) throw controllerError('WIDGET_PREVIEW_ARTIFACT_INVALID', 'Preview UI artifact exceeds its safe size limit.');
      const bytes = uiArtifact.bytes;
      if (createHash('sha256').update(bytes).digest('hex') !== uiArtifact.digestSha256) {
        throw controllerError('WIDGET_PREVIEW_ARTIFACT_INVALID', 'Preview UI artifact integrity verification failed.');
      }
      const envelope = fnDecodeWidgetUiArtifactEnvelope(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
      if (
        envelope.sourceDigestSha256 !== preview.draftRevisionSha256
        || envelope.builderIdentity !== preview.builderIdentity
      ) throw controllerError('WIDGET_PREVIEW_ARTIFACT_INVALID', 'Preview UI artifact identity is inconsistent.');
      const browserDescriptors = ZWidgetBrowserFunctionDescriptors.parse(
        preview.functionDescriptors.map(({ modulePath: _modulePath, ...descriptor }) => descriptor),
      );
      const ready: TWidgetPreviewReady = {
        ready: true,
        draftId: preview.draftId,
        definitionId: preview.definitionId,
        name: preview.manifest.name,
        revision: preview.draftRevisionSha256,
        manifest: preview.manifest,
        uiArtifact: {
          digestSha256: uiArtifact.digestSha256,
          byteSize: bytes.byteLength,
          bytesBase64: Buffer.from(bytes).toString('base64'),
        },
        contract: {
          digestSha256: preview.contractDigestSha256,
          functions: browserDescriptors,
        },
        diagnostics: [],
      };
      return ready;
    } catch (error) {
      const message = errorMessage(error);
      return this.#previewFailure(preview.draftId, 'artifact-unavailable', message, {
        revision: preview.draftRevisionSha256,
        diagnostics: [message],
      });
    }
  }

  async #ensureDurableDraft(
    captured: TCapturedDraft,
    chatExternalKey?: string,
  ): Promise<TAgentAuthoringDraftDescriptor | null> {
    const existing = await this.#config.authoringStore.getDraftByName(
      this.#config.tenant,
      captured.workspace.name,
    );
    if (existing) return existing;
    if (!chatExternalKey) return null;
    let chat = await this.#config.authoringStore.getChatByExternalSessionKey(
      this.#config.tenant,
      chatExternalKey,
    );
    if (!chat) {
      try {
        chat = await this.#config.authoringStore.createChat(this.#config.tenant, {
          id: this.#config.createId(),
          canvasId: this.#config.tenant.canvasId ?? null,
          externalSessionKey: chatExternalKey,
          name: chatExternalKey,
          workspaceRelativePath: relative(
            this.#config.workspace.agentRoot,
            this.#config.workspace.getChatRoot(chatExternalKey),
          ),
          historyRelativePath: relative(
            this.#config.workspace.agentRoot,
            this.#config.workspace.getChatHistoryRoot(chatExternalKey),
          ),
          nowMs: this.#now(),
        });
      } catch {
        chat = await this.#config.authoringStore.getChatByExternalSessionKey(
          this.#config.tenant,
          chatExternalKey,
        );
      }
    }
    if (!chat) throw controllerError('AGENT_CHAT_CREATE_FAILED', 'Agent chat could not be created.');
    try {
      return await this.#config.authoringStore.createDraft(this.#config.tenant, {
        id: this.#config.createId(),
        chatId: chat.id,
        definitionId: this.#config.createId(),
        name: captured.workspace.name,
        sourceRelativePath: this.#sourceRelativePath(captured.workspace),
        nowMs: this.#now(),
      });
    } catch {
      const raced = await this.#config.authoringStore.getDraftByName(
        this.#config.tenant,
        captured.workspace.name,
      );
      if (raced) return raced;
      throw controllerError('AGENT_DRAFT_CREATE_FAILED', 'Widget draft metadata could not be created.');
    }
  }

  async #compareAndSetDraft(
    draft: TAgentAuthoringDraftDescriptor,
    nextDigest: string,
    args: Readonly<{
      status: TAgentAuthoringDraftDescriptor['status'];
      lastError?: Readonly<Record<string, unknown>> | null;
    }>,
  ): Promise<TAgentAuthoringDraftDescriptor | null> {
    if (draft.status === 'discarded') return null;
    if (
      draft.sourceDigestSha256 === nextDigest
      && draft.status === args.status
      && args.lastError === undefined
    ) return draft;
    const result = await this.#config.authoringStore.compareAndSetDraft(this.#config.tenant, {
      draftId: draft.id,
      expectedSourceDigestSha256: draft.sourceDigestSha256,
      nextSourceDigestSha256: nextDigest,
      nextStatus: args.status,
      ...(args.lastError === undefined ? {} : { lastError: args.lastError }),
      nowMs: this.#now(),
    });
    if (result.status === 'updated') {
      return result.draft.status === 'discarded' ? null : result.draft;
    }
    if (
      result.current
      && result.current.id === draft.id
      && result.current.status !== 'discarded'
      && result.current.sourceDigestSha256 === nextDigest
    ) return result.current;
    return null;
  }

  async #recordPublishedRevision(
    original: TAgentAuthoringDraftDescriptor,
    publishedSourceRevision: string,
    publishedRevisionId: string,
  ): Promise<void> {
    let current = original;
    // Publication is already committed before this metadata transition. Make
    // a bounded best-effort attempt instead of risking an unbounded API call.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (current.id !== original.id || current.definitionId !== original.definitionId) {
        throw controllerError(
          'AGENT_AUTHORING_INTEGRITY_FAILED',
          'Published revision does not belong to the durable widget draft.',
        );
      }
      if (current.status === 'discarded') return;
      const sourceAdvanced = current.sourceDigestSha256 !== publishedSourceRevision;
      const result = await this.#config.authoringStore.compareAndSetDraft(this.#config.tenant, {
        draftId: original.id,
        expectedSourceDigestSha256: current.sourceDigestSha256,
        nextSourceDigestSha256: current.sourceDigestSha256 ?? publishedSourceRevision,
        nextStatus: sourceAdvanced ? current.status : 'published',
        publishedRevisionId,
        ...(sourceAdvanced ? {} : { lastError: null }),
        nowMs: this.#now(),
      });
      if (result.status === 'updated') return;
      if (!result.current) {
        throw controllerError(
          'AGENT_AUTHORING_INTEGRITY_FAILED',
          'Durable widget draft disappeared after publication committed.',
        );
      }
      current = result.current;
    }
  }

  async #idempotentPublishedRevisionId(
    draft: TAgentAuthoringDraftDescriptor,
    sourceDigestSha256: string,
    currentActiveRevisionId: string | null,
  ): Promise<string | null> {
    if (!currentActiveRevisionId) return null;
    const [active, source] = await Promise.all([
      this.#config.widgets.getActiveRevision(this.#config.tenant, draft.definitionId),
      this.#config.widgets.getRevisionSource(this.#config.tenant, currentActiveRevisionId),
    ]);
    return active?.id === currentActiveRevisionId
      && active.definitionId === draft.definitionId
      && source?.revisionId === currentActiveRevisionId
      && source.definitionId === draft.definitionId
      && source.sourceDigestSha256 === sourceDigestSha256
      ? currentActiveRevisionId
      : null;
  }

  async #withCapturedWorkspace<T>(
    workspace: TWidgetDraftWorkspaceEntry,
    operation: (captured: TCapturedDraft) => Promise<T>,
  ): Promise<T> {
    const copied = await this.#config.workspace.createTransientDraftSnapshot(
      workspace.name,
      workspace.revision,
    );
    try {
      const snapshot = await this.#config.widgets.captureSource(
        this.#config.tenant,
        copied.rootPath,
        { id: this.#config.createId(), createdAtMs: this.#now() },
      );
      return await operation({ workspace, rootPath: copied.rootPath, snapshot });
    } finally {
      await copied.dispose().catch(() => undefined);
    }
  }

  async #currentDraftRevision(
    draft: TAgentAuthoringDraftDescriptor,
  ): Promise<string | null> {
    const workspace = await this.#config.workspace.getDraft(draft.name);
    if (!workspace) return null;
    return this.#withCapturedWorkspace(workspace, async (captured) => {
      const current = await this.#compareAndSetDraft(draft, captured.snapshot.digestSha256, {
        status: draft.sourceDigestSha256 === captured.snapshot.digestSha256
          ? draft.status
          : 'editing',
      });
      return current?.sourceDigestSha256 ?? captured.snapshot.digestSha256;
    });
  }

  async #currentWorkspaceSourceRevision(name: string, fallback: string): Promise<string> {
    const workspace = await this.#config.workspace.getDraft(name).catch(() => null);
    if (!workspace) return fallback;
    try {
      return await this.#withCapturedWorkspace(
        workspace,
        async (captured) => captured.snapshot.digestSha256,
      );
    } catch {
      return fallback;
    }
  }

  #managementChatExternalKey(definitionId: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(definitionId)) {
      throw controllerError('WIDGET_DEFINITION_ID_INVALID', 'Published widget definition identity is invalid.');
    }
    return `widget-management-${definitionId}`;
  }

  #matchesPublicationSeed(
    draft: TAgentAuthoringDraftDescriptor,
    request: Readonly<{
      definitionId: string;
      publishedRevisionId: string;
      snapshot: TWidgetSourceSnapshot;
    }>,
  ): boolean {
    return draft.definitionId === request.definitionId
      && draft.publishedRevisionId === request.publishedRevisionId
      && draft.sourceDigestSha256 === request.snapshot.digestSha256;
  }

  async #mountDurableDraft(draft: TAgentAuthoringDraftDescriptor): Promise<void> {
    const chat = await this.#config.authoringStore.getChat(this.#config.tenant, draft.chatId);
    if (!chat) {
      throw controllerError('AGENT_AUTHORING_INTEGRITY_FAILED', 'Durable widget draft chat is unavailable.');
    }
    await this.#config.workspace.ensureChat(chat.externalSessionKey);
    await this.#config.workspace.loadWidget(chat.externalSessionKey, draft.name);
  }

  async #activeDraft(draftId: string): Promise<TAgentAuthoringDraftDescriptor | null> {
    const draft = await this.#config.authoringStore.getDraft(this.#config.tenant, draftId);
    return draft && draft.status !== 'discarded' ? draft : null;
  }

  async #readManifest(
    root: string,
  ): Promise<{ ok: true; manifest: TWidgetManifestV2 } | { ok: false; message: string }> {
    try {
      const parsed = ZWidgetManifestV2.safeParse(
        JSON.parse(await readFile(join(root, 'vibecanvas.json'), 'utf8')),
      );
      if (!parsed.success) {
        return {
          ok: false,
          message: parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
        };
      }
      return { ok: true, manifest: parsed.data };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  async #hasUiEntry(root: string, entry: string): Promise<boolean> {
    const candidate = resolve(root, entry);
    const rel = relative(resolve(root), candidate);
    if (rel.startsWith('..') || isAbsolute(rel)) return false;
    return Boolean((await stat(candidate).catch(() => null))?.isFile());
  }

  #validationForDraft(
    draft: TAgentAuthoringDraftDescriptor,
    revision: string,
  ): TWidgetDraftSummary['validation'] {
    const cached = this.#validationByDraft.get(draft.id);
    if (cached?.revision === revision) {
      return {
        status: cached.ok ? 'valid' : 'invalid',
        errors: cached.errors,
        warnings: cached.warnings,
        validatedRevision: revision,
      };
    }
    if (
      draft.sourceDigestSha256 === revision
      && (draft.status === 'ready' || draft.status === 'published')
    ) {
      return { status: 'valid', errors: [], warnings: [], validatedRevision: revision };
    }
    if (draft.sourceDigestSha256 === revision && draft.status === 'error') {
      const errors = Array.isArray(draft.lastError?.errors)
        ? draft.lastError.errors.filter((value): value is string => typeof value === 'string').slice(0, 40)
        : [];
      const warnings = Array.isArray(draft.lastError?.warnings)
        ? draft.lastError.warnings.filter((value): value is string => typeof value === 'string').slice(0, 40)
        : [];
      return { status: 'invalid', errors, warnings, validatedRevision: revision };
    }
    return { status: 'unknown', errors: [], warnings: [] };
  }

  #validationError(validation: TValidationResult): Readonly<Record<string, unknown>> {
    return Object.freeze({
      kind: 'validation',
      errors: validation.errors.slice(0, 40),
      warnings: validation.warnings.slice(0, 40),
    });
  }

  #sourceRelativePath(workspace: TWidgetDraftWorkspaceEntry): string {
    const value = relative(this.#config.workspace.agentRoot, workspace.draftPath);
    if (!value || value.startsWith('..') || isAbsolute(value)) {
      throw controllerError('AGENT_DRAFT_PATH_INVALID', 'Widget draft path is outside the agent workspace.');
    }
    return value.split('\\').join('/');
  }

  #previewFailure(
    draftId: string,
    reason: TWidgetPreviewFailureReason,
    message: string,
    details: Readonly<{
      revision?: string;
      diagnostics?: readonly string[];
    }> = {},
  ): Exclude<TWidgetPreviewResult, { ready: true }> {
    return {
      ready: false,
      draftId,
      ...details,
      reason,
      message,
      diagnostics: details.diagnostics ?? [],
    };
  }

  #publishFailure(
    draftId: string,
    reason: Exclude<TWidgetPublishResult, { published: true }>['reason'],
    message: string,
    currentRevision?: string,
    errors: readonly string[] = [],
    warnings: readonly string[] = [],
  ): Exclude<TWidgetPublishResult, { published: true }> {
    return {
      published: false,
      draftId,
      reason,
      message,
      ...(currentRevision === undefined ? {} : { currentRevision }),
      errors,
      warnings,
    };
  }

  #publishDraftEvent(
    type: 'created' | 'changed' | 'validated',
    draftId: string,
    revision: string,
  ): void {
    try {
      this.#config.eventPublisher.publishAgentEvent({
        kind: 'widget-draft',
        type,
        draftId,
        revision,
      });
    } catch {}
  }

  #now(): number {
    const value = this.#config.nowMs();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError('Widget authoring clock returned an invalid timestamp.');
    }
    return value;
  }

  #queue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    return this.#queueMany([key], operation);
  }

  #queueMany<T>(keys: readonly string[], operation: () => Promise<T>): Promise<T> {
    const uniqueKeys = [...new Set(keys)].sort();
    const previous = Promise.all(uniqueKeys.map((key) => (
      this.#operations.get(key)?.catch(() => undefined) ?? Promise.resolve()
    )));
    const current = previous.then(operation);
    const tracked = current.finally(() => {
      for (const key of uniqueKeys) {
        if (this.#operations.get(key) === tracked) this.#operations.delete(key);
      }
    });
    for (const key of uniqueKeys) this.#operations.set(key, tracked);
    return tracked;
  }

  #draftOperationKey(draftId: string): string {
    return `draft:${draftId}`;
  }
}
