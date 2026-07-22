import { Actor, type TActorEvent } from '@vibecanvas/service-actor/Actor';
import { ResourceError } from '@vibecanvas/resource-runtime';
import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import { ZVibecanvasJson } from '@vibecanvas/service-actor/core/vibecanvasjson.zod';
import type { TAgentDraftActorEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import {
  readFile,
  readdir,
  stat,
} from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fnPatchDraftManifest } from '../core/fn.patch-draft-manifest';
import { fxEffectiveWidgetDraftResourceBindingSelectionRecord } from '../core/fx.session-records';
import {
  planImplicitResourceSelections,
  planSelectedResourceBindings,
  type TResourceBindingPlan,
} from '../tools/resource-bindings';
import type {
  ILegacyActorAgentCapability,
  TAgentChatPublishResult,
  TAgentDraftActorNotReadyReason,
  TAgentDraftActorNotReadyResult,
  TAgentDraftActorResult,
  TAgentDraftActorSendResult,
  TAgentDraftActorSnapshot,
  TAgentDraftActorStopResult,
  TAgentDraftManifestPatch,
  TAgentDraftManifestPatchResult,
  TAgentDraftManifestReadResult,
  TAgentPreviewSourceResult,
  TLegacyActorAgentCapabilityFactory,
  TLegacyActorAgentHost,
  TLegacyActorServiceCapability,
} from './interface';

type TDraftActorEntry = {
  actor: Actor;
  widgetId: string;
  sessionId: string;
  unlisten: () => void;
  closing?: Promise<void>;
};

export type TCreateLegacyActorAgentCapabilityFactory = Readonly<{
  actorService: TLegacyActorServiceCapability;
  resolvePublishedWidgetManifest(
    definitionName: string,
  ): Promise<(TVibecanvasJson & { manifest_path: string }) | null>;
  onCreate?(capability: ILegacyActorAgentCapability): void;
  onClose?(capability: ILegacyActorAgentCapability): void;
}>;

class LegacyActorAgentCapability implements ILegacyActorAgentCapability {
  readonly #host: TLegacyActorAgentHost;
  readonly #actorService: TLegacyActorServiceCapability;
  readonly #resolvePublishedWidgetManifest: TCreateLegacyActorAgentCapabilityFactory['resolvePublishedWidgetManifest'];
  readonly #onClose?: TCreateLegacyActorAgentCapabilityFactory['onClose'];
  readonly #draftActors = new Map<string, TDraftActorEntry>();
  #closed = false;
  #closePromise: Promise<void> | null = null;

  constructor(
    host: TLegacyActorAgentHost,
    config: TCreateLegacyActorAgentCapabilityFactory,
  ) {
    this.#host = host;
    this.#actorService = config.actorService;
    this.#resolvePublishedWidgetManifest = config.resolvePublishedWidgetManifest;
    this.#onClose = config.onClose;
  }

  parseManifest(value: unknown): TVibecanvasJson | null {
    const parsed = ZVibecanvasJson.safeParse(value);
    return parsed.success ? parsed.data as TVibecanvasJson : null;
  }

  resolvePublishedWidgetManifest(
    definitionName: string,
  ): Promise<(TVibecanvasJson & { manifest_path: string }) | null> {
    return this.#resolvePublishedWidgetManifest(definitionName);
  }

  async deletePublishedDefinition(definitionName: string): Promise<boolean> {
    if (!this.#actorService.deleteDefinition) return false;
    return this.#actorService.deleteDefinition(definitionName);
  }

  inspectDraftActorChat(widgetId: string, sessionId: string): TAgentDraftActorResult {
    const entry = this.#draftActors.get(this.#draftActorKey(widgetId, sessionId));
    if (!entry) return this.#notReady(widgetId, sessionId, 'actor-not-running');
    return {
      ready: true,
      actorId: entry.actor.getId(),
      snapshot: this.#snapshot(entry.actor),
    };
  }

  async startDraftActorChat(
    widgetId: string,
    sessionId: string,
  ): Promise<TAgentDraftActorResult> {
    const sessionManager = this.#host.getSessionManager(widgetId, sessionId);
    if (!sessionManager) return this.#notReady(widgetId, sessionId, 'session-missing');

    const mount = await this.#host.resolveActiveMount(widgetId, sessionId);
    if (!mount) return this.#notReady(widgetId, sessionId, 'manifest-missing');
    const rootDir = mount.targetPath;
    const manifestResult = await this.#readManifest(rootDir);
    if (!manifestResult.ready) return manifestResult;

    const actorFunctionPath = join(rootDir, manifestResult.manifest.actor.relFunctionPath);
    if (!(await stat(actorFunctionPath).catch(() => null))?.isFile()) {
      return {
        ready: false,
        reason: 'actor-functions-missing',
        message: `Draft actor functions file does not exist: ${manifestResult.manifest.actor.relFunctionPath}`,
      };
    }

    await this.disposeChat(widgetId, sessionId);
    const bindingPlan = await this.#resourceBindingPlan(
      manifestResult.manifest,
      sessionManager,
    );
    if (!bindingPlan.ok) {
      return {
        ready: false,
        reason: 'resource-binding-invalid',
        message: bindingPlan.message,
      };
    }
    if (
      bindingPlan.bindings.length > 0
      && !this.#actorService.callWithDirectResourceBinding
    ) {
      return {
        ready: false,
        reason: 'resource-binding-invalid',
        message: 'Selected resources cannot be used by Preview in this host.',
      };
    }

    const directBindings = new Map(
      bindingPlan.bindings.map((binding) => [binding.slot, binding]),
    );
    const resourceGateway = this.#actorService.callWithDirectResourceBinding
      ? (call: Parameters<NonNullable<TLegacyActorServiceCapability['callWithDirectResourceBinding']>>[0]) => {
          const binding = directBindings.get(call.slot);
          const requirement = manifestResult.manifest.actor.resources?.[call.slot];
          if (!binding || !requirement) {
            throw new ResourceError(
              'RESOURCE_NOT_BOUND',
              `Draft resource slot '${call.slot}' has no selected Preview binding.`,
            );
          }
          return this.#actorService.callWithDirectResourceBinding!(call, {
            resourceId: binding.resource.id,
            requirement,
            scope: binding.scope,
          });
        }
      : undefined;

    const actor = new Actor({
      id: `draft:${widgetId}:${sessionId}`,
      vsJson: manifestResult.manifest,
      rootDir,
      resourceGateway,
    });
    const unlisten = actor.listen((event) => {
      this.#publishDraftActorEvent(widgetId, sessionId, actor, event);
    });
    try {
      actor.start();
      this.#draftActors.set(this.#draftActorKey(widgetId, sessionId), {
        actor,
        widgetId,
        sessionId,
        unlisten,
      });
      await actor.waitUntilReady();
    } catch (error) {
      unlisten();
      const stopped = await actor.closeAndWait();
      const key = this.#draftActorKey(widgetId, sessionId);
      const entry = this.#draftActors.get(key);
      if (stopped && entry?.actor === actor) this.#draftActors.delete(key);
      if (!stopped) {
        throw new AggregateError(
          [error, new Error(`Draft actor '${actor.getId()}' did not exit after startup failed.`)],
          'Draft actor startup and cleanup failed.',
        );
      }
      throw error;
    }

    return {
      ready: true,
      actorId: actor.getId(),
      snapshot: this.#snapshot(actor),
    };
  }

  async stopDraftActorChat(
    widgetId: string,
    sessionId: string,
  ): Promise<TAgentDraftActorStopResult> {
    const stopped = this.#draftActors.has(this.#draftActorKey(widgetId, sessionId));
    await this.disposeChat(widgetId, sessionId);
    return { stopped };
  }

  sendDraftActorChat(
    widgetId: string,
    sessionId: string,
    name: string,
    payload: unknown,
  ): TAgentDraftActorSendResult {
    const entry = this.#draftActors.get(this.#draftActorKey(widgetId, sessionId));
    if (!entry) return this.#notReady(widgetId, sessionId, 'actor-not-running');
    return {
      ready: true,
      messageId: entry.actor.inbox(name, payload),
      snapshot: this.#snapshot(entry.actor),
    };
  }

  async previewSourceChat(
    widgetId: string,
    sessionId: string,
  ): Promise<TAgentPreviewSourceResult> {
    if (!this.#host.getSessionManager(widgetId, sessionId)) {
      return this.#notReady(widgetId, sessionId, 'session-missing');
    }
    const mount = await this.#host.resolveActiveMount(widgetId, sessionId);
    if (!mount) return this.#notReady(widgetId, sessionId, 'manifest-missing');
    const manifestResult = await this.#readManifest(mount.targetPath);
    if (!manifestResult.ready) return manifestResult;
    return {
      ready: true,
      manifest: manifestResult.manifest,
      sources: await this.#readWidgetSourceMap(
        mount.targetPath,
        manifestResult.manifest.widget.relWidgetDir,
      ),
    };
  }

  async readDraftManifestChat(
    widgetId: string,
    sessionId: string,
  ): Promise<TAgentDraftManifestReadResult> {
    if (!this.#host.getSessionManager(widgetId, sessionId)) {
      return {
        ready: false,
        reason: 'session-missing',
        message: this.#manifestMessage(widgetId, sessionId, 'session-missing'),
      };
    }
    const mount = await this.#host.resolveActiveMount(widgetId, sessionId);
    if (!mount) {
      return {
        ready: false,
        reason: 'manifest-missing',
        message: 'No widget is selected in this chat. Load or create a widget first.',
      };
    }
    const result = await this.#readManifest(mount.targetPath);
    return result.ready
      ? { ready: true, source: 'file', manifest: result.manifest }
      : {
          ready: false,
          reason: result.reason === 'manifest-missing'
            ? 'manifest-missing'
            : 'manifest-invalid',
          message: result.message,
        };
  }

  async patchDraftManifestChat(
    widgetId: string,
    sessionId: string,
    patch: TAgentDraftManifestPatch,
  ): Promise<TAgentDraftManifestPatchResult> {
    if (!this.#host.getSessionManager(widgetId, sessionId)) {
      return {
        ok: false,
        reason: 'session-missing',
        message: this.#manifestMessage(widgetId, sessionId, 'session-missing'),
      };
    }
    const mount = await this.#host.resolveActiveMount(widgetId, sessionId);
    if (!mount) {
      return {
        ok: false,
        reason: 'manifest-missing',
        message: 'No widget is selected in this chat. Load or create a widget first.',
      };
    }
    const current = await this.#readManifest(mount.targetPath);
    if (!current.ready) {
      return {
        ok: false,
        reason: current.reason === 'manifest-missing'
          ? 'manifest-missing'
          : 'manifest-invalid',
        message: current.message,
      };
    }
    const plan = fnPatchDraftManifest({ manifest: current.manifest, patch });
    if (plan.issues.length > 0) {
      return {
        ok: false,
        reason: 'edit-invalid',
        message: plan.issues.join('; '),
        issues: plan.issues,
      };
    }
    const parsed = ZVibecanvasJson.safeParse(plan.manifest);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      );
      return {
        ok: false,
        reason: 'initialData' in patch || 'dataSchema' in patch || patch.tool !== undefined
          ? 'edit-invalid'
          : 'manifest-invalid',
        message: issues.join('; '),
        issues,
      };
    }
    const manifest = parsed.data as TVibecanvasJson;
    if (manifest.name !== mount.name) {
      return {
        ok: false,
        reason: 'edit-invalid',
        message: `Published identity is '${mount.name}'. Renaming requires creating and publishing a new widget.`,
        issues: ['In-place widget rename is not supported.'],
      };
    }
    await this.#host.workspace.writeMountedFileAtomic(
      sessionId,
      `widgets/${mount.name}/vibecanvas.json`,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    return { ok: true, source: 'file', manifest };
  }

  async publishChat(
    _widgetId: string,
    _sessionId: string,
  ): Promise<TAgentChatPublishResult> {
    return {
      published: false,
      manifest: null,
      destination: null,
      message: 'Legacy actor publication is unavailable. Publish manifest v2 through the widget draft API.',
    };
  }

  async disposeChat(widgetId: string, sessionId: string): Promise<void> {
    const key = this.#draftActorKey(widgetId, sessionId);
    const entry = this.#draftActors.get(key);
    if (!entry) return;
    if (entry.closing) return entry.closing;
    entry.unlisten();
    const closing = (async () => {
      const stopped = await entry.actor.closeAndWait();
      if (!stopped) {
        throw new Error(`Draft actor '${entry.actor.getId()}' did not exit during shutdown.`);
      }
      if (this.#draftActors.get(key) === entry) this.#draftActors.delete(key);
      this.#publishDraftActorEvent(widgetId, sessionId, entry.actor, {
        kind: 'lifecycle',
        type: 'stopped',
        actorId: entry.actor.getId(),
      });
    })();
    entry.closing = closing;
    try {
      await closing;
    } finally {
      if (entry.closing === closing) entry.closing = undefined;
    }
  }

  diagnostics() {
    return {
      activeProcessCount: [...this.#draftActors.values()].filter(
        (entry) => entry.actor.hasActiveProcess(),
      ).length,
    };
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    const closing = (async () => {
      const results = await Promise.allSettled(
        [...this.#draftActors.values()].map((entry) => (
          this.disposeChat(entry.widgetId, entry.sessionId)
        )),
      );
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason);
      if (failures.length > 0) {
        throw new AggregateError(failures, 'One or more draft actor child processes did not exit during shutdown.');
      }
      this.#onClose?.(this);
    })();
    this.#closePromise = closing;
    void closing.catch(() => {
      if (this.#closePromise === closing) this.#closePromise = null;
    });
    return closing;
  }

  async #resourceBindingPlan(
    manifest: TVibecanvasJson,
    sessionManager: Parameters<typeof fxEffectiveWidgetDraftResourceBindingSelectionRecord>[0]['sessionManager'],
  ): Promise<
    | { ok: true; bindings: TResourceBindingPlan[] }
    | { ok: false; message: string }
  > {
    const requirements = Object.keys(manifest.actor.resources ?? {});
    if (requirements.length === 0) return { ok: true, bindings: [] };

    const selectedRecord = fxEffectiveWidgetDraftResourceBindingSelectionRecord(
      { sessionManager },
      {},
    );
    let selected = selectedRecord?.resources ?? [];
    if (!selectedRecord) {
      const resourceService = this.#host.resourceService;
      if (!resourceService?.listResources) {
        return {
          ok: false,
          message: 'Resources cannot be discovered in this host. The widget was not published.',
        };
      }
      const available = await resourceService.listResources({ status: 'ready' });
      const implicit = planImplicitResourceSelections(
        manifest,
        available.map((resource) => ({
          id: resource.id,
          kind: resource.kind,
          name: resource.name,
          status: resource.status,
        })),
      );
      if (!implicit.ok) return implicit;
      selected = implicit.resources;
    }
    return planSelectedResourceBindings(manifest, selected);
  }

  async #readManifest(rootDir: string): Promise<
    | { ready: true; manifest: TVibecanvasJson }
    | TAgentDraftActorNotReadyResult
  > {
    const manifestPath = join(rootDir, 'vibecanvas.json');
    if (!(await stat(manifestPath).catch(() => null))?.isFile()) {
      return {
        ready: false,
        reason: 'manifest-missing',
        message: 'Draft vibecanvas.json does not exist yet.',
      };
    }
    try {
      const parsed = ZVibecanvasJson.safeParse(
        JSON.parse(await readFile(manifestPath, 'utf8')),
      );
      if (!parsed.success) {
        return {
          ready: false,
          reason: 'manifest-invalid',
          message: parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
        };
      }
      return { ready: true, manifest: parsed.data as TVibecanvasJson };
    } catch (error) {
      return {
        ready: false,
        reason: 'manifest-invalid',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async #readWidgetSourceMap(
    rootDir: string,
    relWidgetDir: string,
  ): Promise<Record<string, string>> {
    const root = resolve(rootDir);
    const widgetDir = resolve(root, relWidgetDir);
    if (widgetDir !== root && !widgetDir.startsWith(`${root}/`)) return {};
    if (!(await stat(widgetDir).catch(() => null))?.isDirectory()) return {};
    const sources: Record<string, string> = {};
    await this.#readSourceMapRecursive(widgetDir, widgetDir, sources);
    return sources;
  }

  async #readSourceMapRecursive(
    rootDir: string,
    directory: string,
    sources: Record<string, string>,
  ): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.#readSourceMapRecursive(rootDir, absolutePath, sources);
      } else if (entry.isFile()) {
        sources[relative(rootDir, absolutePath)] = await readFile(absolutePath, 'utf8');
      }
    }
  }

  #draftActorKey(widgetId: string, sessionId: string): string {
    return JSON.stringify([widgetId, sessionId]);
  }

  #snapshot(actor: Actor): TAgentDraftActorSnapshot {
    return { state: actor.getState(), context: actor.getData() };
  }

  #notReady(
    widgetId: string,
    sessionId: string,
    reason: TAgentDraftActorNotReadyReason,
  ): TAgentDraftActorNotReadyResult {
    const label = `widget '${widgetId}' and session '${sessionId}'`;
    const messages: Record<TAgentDraftActorNotReadyReason, string> = {
      'legacy-disabled': `Legacy actor compatibility is disabled for ${label}`,
      'manifest-missing': `Draft vibecanvas.json does not exist for ${label}`,
      'manifest-invalid': `Draft vibecanvas.json is invalid for ${label}`,
      'actor-functions-missing': `Draft actor functions file does not exist for ${label}`,
      'session-missing': `No connected agent session for ${label}`,
      'resource-binding-invalid': `Draft resources cannot be bound for ${label}`,
      'actor-not-running': `No draft actor is running for ${label}`,
    };
    return { ready: false, reason, message: messages[reason] };
  }

  #manifestMessage(
    widgetId: string,
    sessionId: string,
    reason: 'session-missing' | 'manifest-missing' | 'manifest-invalid',
  ): string {
    const label = `widget '${widgetId}' and session '${sessionId}'`;
    return {
      'manifest-missing': `Draft vibecanvas.json does not exist for ${label}`,
      'manifest-invalid': `Draft vibecanvas.json is invalid for ${label}`,
      'session-missing': `No connected agent session for ${label}`,
    }[reason];
  }

  #publishDraftActorEvent(
    widgetId: string,
    sessionId: string,
    actor: Actor,
    event: TAgentDraftActorEvent['event'] | TActorEvent,
  ): void {
    this.#host.eventPublisherService.publishAgentEvent({
      kind: 'draft-actor',
      widgetId,
      sessionId,
      event,
      snapshot: this.#snapshot(actor),
    });
  }
}

export function createLegacyActorAgentCapabilityFactory(
  config: TCreateLegacyActorAgentCapabilityFactory,
): TLegacyActorAgentCapabilityFactory {
  return {
    parseManifest(value) {
      const parsed = ZVibecanvasJson.safeParse(value);
      return parsed.success ? parsed.data as TVibecanvasJson : null;
    },
    create(host) {
      const capability = new LegacyActorAgentCapability(host, config);
      config.onCreate?.(capability);
      return capability;
    },
  };
}

export { LegacyActorAgentCapability };
