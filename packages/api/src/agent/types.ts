import type { InferContractRouterInputs, InferContractRouterOutputs } from '@orpc/contract';
import type { TToolGroupDatabaseCapability } from '../interface';
import type { agentContract, TAgentEvent } from './contract';

type TAgentInputs = InferContractRouterInputs<typeof agentContract>;
type TAgentOutputs = InferContractRouterOutputs<typeof agentContract>;

type TAgentAuthorization = {
  accountId?: string;
  requestId?: string;
};

type TAgentPromptInput = TAgentInputs['chat']['prompt'];
type TAgentPromptSelection = Pick<
  TAgentPromptInput,
  'images' | 'model' | 'resourceIds' | 'thinkingLevel' | 'widgetRefs'
>;

export type TAgentApiCapability = {
  settings(): Promise<TAgentOutputs['settings']['get']>;

  connectChat(
    widgetId: TAgentInputs['chat']['connect']['widgetId'],
    sessionId: TAgentInputs['chat']['connect']['sessionId'],
    authorization?: TAgentAuthorization,
    mode?: NonNullable<TAgentInputs['chat']['connect']['mode']>,
  ): Promise<TAgentOutputs['chat']['connect']>;
  promptChat(
    widgetId: TAgentPromptInput['widgetId'],
    sessionId: TAgentPromptInput['sessionId'],
    text: TAgentPromptInput['text'],
    selection?: TAgentPromptSelection,
  ): Promise<void>;
  clearDraftResourceBindingsChat(
    widgetId: TAgentInputs['chat']['resourceBindings']['clear']['widgetId'],
    sessionId: TAgentInputs['chat']['resourceBindings']['clear']['sessionId'],
  ): TAgentOutputs['chat']['resourceBindings']['clear'];
  approveChatDbChange(
    widgetId: TAgentInputs['chat']['dbChange']['approve']['widgetId'],
    sessionId: TAgentInputs['chat']['dbChange']['approve']['sessionId'],
    proposalId: TAgentInputs['chat']['dbChange']['approve']['proposalId'],
  ): Promise<TAgentOutputs['chat']['dbChange']['approve']>;
  rejectChatDbChange(
    widgetId: TAgentInputs['chat']['dbChange']['reject']['widgetId'],
    sessionId: TAgentInputs['chat']['dbChange']['reject']['sessionId'],
    proposalId: TAgentInputs['chat']['dbChange']['reject']['proposalId'],
  ): TAgentOutputs['chat']['dbChange']['reject'];
  listChatApprovals(
    widgetId: TAgentInputs['chat']['approval']['list']['widgetId'],
    sessionId: TAgentInputs['chat']['approval']['list']['sessionId'],
  ): TAgentOutputs['chat']['approval']['list'];
  getChatApproval(
    widgetId: TAgentInputs['chat']['approval']['get']['widgetId'],
    sessionId: TAgentInputs['chat']['approval']['get']['sessionId'],
    approvalId: TAgentInputs['chat']['approval']['get']['approvalId'],
  ): TAgentOutputs['chat']['approval']['get'];
  resolveChatApproval(
    widgetId: TAgentInputs['chat']['approval']['resolve']['widgetId'],
    sessionId: TAgentInputs['chat']['approval']['resolve']['sessionId'],
    approvalId: TAgentInputs['chat']['approval']['resolve']['approvalId'],
    decision: TAgentInputs['chat']['approval']['resolve']['decision'],
    authorization?: TAgentAuthorization,
  ): Promise<TAgentOutputs['chat']['approval']['resolve']>;
  cancelChat(
    widgetId: TAgentInputs['chat']['cancel']['widgetId'],
    sessionId: TAgentInputs['chat']['cancel']['sessionId'],
  ): Promise<TAgentOutputs['chat']['cancel']>;
  newChatSession(
    widgetId: TAgentInputs['chat']['newSession']['widgetId'],
    sessionId: TAgentInputs['chat']['newSession']['sessionId'],
  ): Promise<void>;

  listWidgetDrafts(): Promise<TAgentOutputs['widgetDraft']['list']>;
  getWidgetDraft(
    draftId: TAgentInputs['widgetDraft']['get']['draftId'],
  ): Promise<TAgentOutputs['widgetDraft']['get']>;
  validateWidgetDraft(
    draftId: TAgentInputs['widgetDraft']['validate']['draftId'],
    expectedRevision: TAgentInputs['widgetDraft']['validate']['expectedRevision'],
  ): Promise<TAgentOutputs['widgetDraft']['validate']>;

  buildWidgetPreview(
    draftId: TAgentInputs['widgetPreview']['build']['draftId'],
  ): Promise<TAgentOutputs['widgetPreview']['build']>;
  publishWidgetDraft(
    draftId: TAgentInputs['widgetPublish']['publish']['draftId'],
    expectedRevision: TAgentInputs['widgetPublish']['publish']['expectedRevision'],
  ): Promise<TAgentOutputs['widgetPublish']['publish']>;

  getWidgetCatalog(
    groups: TAgentOutputs['widgets']['groups']['create'][],
  ): Promise<TAgentOutputs['widgets']['catalog']>;
  getWidgetDetail(
    name: TAgentInputs['widgets']['detail']['name'],
    source: TAgentInputs['widgets']['detail']['source'],
  ): Promise<TAgentOutputs['widgets']['detail']>;
  listWidgetFiles(
    name: TAgentInputs['widgets']['files']['name'],
    source: TAgentInputs['widgets']['files']['source'],
  ): Promise<TAgentOutputs['widgets']['files']>;
  readWidgetFile(
    name: TAgentInputs['widgets']['file']['name'],
    source: TAgentInputs['widgets']['file']['source'],
    path: TAgentInputs['widgets']['file']['path'],
  ): Promise<TAgentOutputs['widgets']['file']>;
  ensureWidgetDraft(
    name: TAgentInputs['widgets']['ensureDraft']['name'],
    expectedPublishedFingerprint?: TAgentInputs['widgets']['ensureDraft']['expectedPublishedFingerprint'],
  ): Promise<TAgentOutputs['widgets']['ensureDraft']>;
  patchWidgetDraftTool(
    name: TAgentInputs['widgets']['patchDraftTool']['name'],
    expectedRevision: TAgentInputs['widgets']['patchDraftTool']['expectedRevision'],
    patch: TAgentInputs['widgets']['patchDraftTool']['patch'],
  ): Promise<TAgentOutputs['widgets']['patchDraftTool']>;
  patchWidgetDraftMetadata(
    name: TAgentInputs['widgets']['patchDraftMetadata']['name'],
    expectedRevision: TAgentInputs['widgets']['patchDraftMetadata']['expectedRevision'],
    patch: TAgentInputs['widgets']['patchDraftMetadata']['patch'],
  ): Promise<TAgentOutputs['widgets']['patchDraftMetadata']>;
  deleteWidget(
    name: TAgentInputs['widgets']['delete']['name'],
    source: TAgentInputs['widgets']['delete']['source'],
  ): Promise<TAgentOutputs['widgets']['delete'] | null>;
  resolveWidgetPlacement(
    reference: TAgentInputs['widgets']['resolvePlacement']['reference'],
    expectedDraftId?: TAgentInputs['widgets']['resolvePlacement']['expectedDraftId'],
  ): Promise<TAgentOutputs['widgets']['resolvePlacement']>;

  login(providerId: TAgentInputs['auth']['login']['providerId']): TAgentOutputs['auth']['login']['loginId'];
  logout(providerId: TAgentInputs['auth']['logout']['providerId']): Promise<void>;
  getLoginStatus(loginId: TAgentInputs['auth']['status']['loginId']): TAgentOutputs['auth']['status'];
  abortLogin(loginId: TAgentInputs['auth']['abort']['loginId']): void;
  setApiKey(
    providerId: TAgentInputs['auth']['apiKey']['set']['providerId'],
    key: TAgentInputs['auth']['apiKey']['set']['key'],
  ): Promise<void>;
  removeApiKey(providerId: TAgentInputs['auth']['apiKey']['remove']['providerId']): Promise<void>;
};

export type TAgentEventCapability = {
  publishAgentEvent(tenant: import('@vibecanvas/tenant-core').TTenantContext, event: TAgentEvent): number;
  subscribeAgentEvents(tenant: import('@vibecanvas/tenant-core').TTenantContext): AsyncIterable<TAgentEvent>;
};

export type TAgentApiContext = {
  db: TToolGroupDatabaseCapability;
  eventPublisher: TAgentEventCapability;
  agent: TAgentApiCapability;
  tenant: import('@vibecanvas/tenant-core').TTenantContext;
};
