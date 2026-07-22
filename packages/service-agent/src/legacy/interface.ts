import type { SessionManager } from '@earendil-works/pi-coding-agent';
import type {
  TActorData,
  TActorState,
  TVibecanvasJson,
} from '@vibecanvas/service-actor/core/types';
import type {
  TActorResourceCall,
  TActorResourceDirectBinding,
} from '@vibecanvas/service-actor/legacy/resource-protocol';
import type { ITenantEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import type { TWidgetManifestPatch } from '../core/fn.patch-draft-manifest';
import type { TAgentResourceService } from '../tools/resource-service';
import type { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import type { TWidgetMount } from '../workspace/types';

export type TAgentDraftActorSnapshot = {
  state: TActorState;
  context: TActorData;
};

export type TAgentDraftActorNotReadyReason =
  | 'legacy-disabled'
  | 'manifest-missing'
  | 'manifest-invalid'
  | 'actor-functions-missing'
  | 'session-missing'
  | 'resource-binding-invalid'
  | 'actor-not-running';

export type TAgentDraftActorNotReadyResult = {
  ready: false;
  reason: TAgentDraftActorNotReadyReason;
  message: string;
};

export type TAgentDraftActorResult =
  | {
      ready: true;
      actorId: string;
      snapshot: TAgentDraftActorSnapshot;
    }
  | TAgentDraftActorNotReadyResult;

export type TAgentDraftActorSendResult =
  | { ready: true; messageId: string; snapshot: TAgentDraftActorSnapshot }
  | TAgentDraftActorNotReadyResult;

export type TAgentDraftActorStopResult = { stopped: boolean };

export type TAgentPreviewSourceResult =
  | { ready: true; manifest: TVibecanvasJson; sources: Record<string, string> }
  | TAgentDraftActorNotReadyResult;

export type TAgentDraftManifestReadResult =
  | { ready: true; source: 'file'; manifest: TVibecanvasJson }
  | {
      ready: false;
      reason: 'legacy-disabled' | 'session-missing' | 'manifest-missing' | 'manifest-invalid';
      message: string;
    };

export type TAgentDraftManifestPatch = TWidgetManifestPatch;

export type TAgentDraftManifestPatchResult =
  | { ok: true; source: 'file'; manifest: TVibecanvasJson }
  | {
      ok: false;
      reason: 'legacy-disabled' | 'session-missing' | 'manifest-missing' | 'manifest-invalid' | 'edit-invalid';
      message: string;
      issues?: string[];
    };

export type TAgentChatPublishResult =
  | { published: true; manifest: TVibecanvasJson; destination: string; files: string[] }
  | {
      published: false;
      manifest: TVibecanvasJson | null;
      destination: null;
      message: string;
      errors?: string[];
      warnings?: string[];
    };

export type TLegacyActorAgentHost = Readonly<{
  workspace: WidgetWorkspace;
  eventPublisherService: ITenantEventPublisherService;
  resourceService?: TAgentResourceService;
  getSessionManager(widgetId: string, sessionId: string): SessionManager | null;
  resolveActiveMount(widgetId: string, sessionId: string): Promise<TWidgetMount | null>;
}>;

export type TLegacyActorAgentDiagnostics = Readonly<{
  activeProcessCount: number;
}>;

/** Narrow compatibility surface consumed by the optional legacy agent adapter. */
export type TLegacyActorServiceCapability = Readonly<{
  deleteDefinition?(definitionName: string): Promise<boolean>;
  getVibecanvasJson?(
    definitionName: string,
  ): (TVibecanvasJson & { manifest_path: string }) | null;
  callWithDirectResourceBinding?(
    call: TActorResourceCall,
    binding: TActorResourceDirectBinding,
  ): Promise<unknown>;
}>;

export interface ILegacyActorAgentCapability {
  parseManifest(value: unknown): TVibecanvasJson | null;
  resolvePublishedWidgetManifest(
    definitionName: string,
  ): Promise<(TVibecanvasJson & { manifest_path: string }) | null>;
  deletePublishedDefinition(definitionName: string): Promise<boolean>;
  inspectDraftActorChat(widgetId: string, sessionId: string): TAgentDraftActorResult;
  startDraftActorChat(widgetId: string, sessionId: string): Promise<TAgentDraftActorResult>;
  stopDraftActorChat(widgetId: string, sessionId: string): Promise<TAgentDraftActorStopResult>;
  sendDraftActorChat(
    widgetId: string,
    sessionId: string,
    name: string,
    payload: unknown,
  ): TAgentDraftActorSendResult;
  previewSourceChat(widgetId: string, sessionId: string): Promise<TAgentPreviewSourceResult>;
  readDraftManifestChat(widgetId: string, sessionId: string): Promise<TAgentDraftManifestReadResult>;
  patchDraftManifestChat(
    widgetId: string,
    sessionId: string,
    patch: TAgentDraftManifestPatch,
  ): Promise<TAgentDraftManifestPatchResult>;
  publishChat(widgetId: string, sessionId: string): Promise<TAgentChatPublishResult>;
  disposeChat(widgetId: string, sessionId: string): Promise<void>;
  diagnostics(): TLegacyActorAgentDiagnostics;
  close(): Promise<void>;
}

export type TLegacyActorAgentCapabilityFactory = Readonly<{
  parseManifest(value: unknown): TVibecanvasJson | null;
  create(host: TLegacyActorAgentHost): ILegacyActorAgentCapability;
}>;
