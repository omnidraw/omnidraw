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
  startWidgetEditChat(
    widgetId: TAgentInputs['chat']['startWidgetEdit']['widgetId'],
    sessionId: TAgentInputs['chat']['startWidgetEdit']['sessionId'],
    definitionName: TAgentInputs['chat']['startWidgetEdit']['definitionName'],
    authorization?: TAgentAuthorization,
  ): Promise<TAgentOutputs['chat']['startWidgetEdit']>;
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
  previewSourceChat(
    widgetId: TAgentInputs['chat']['previewSource']['widgetId'],
    sessionId: TAgentInputs['chat']['previewSource']['sessionId'],
  ): Promise<TAgentOutputs['chat']['previewSource']>;
  publishChat(
    widgetId: TAgentInputs['chat']['publish']['widgetId'],
    sessionId: TAgentInputs['chat']['publish']['sessionId'],
  ): Promise<TAgentOutputs['chat']['publish']>;
  readDraftManifestChat(
    widgetId: TAgentInputs['chat']['draftManifest']['read']['widgetId'],
    sessionId: TAgentInputs['chat']['draftManifest']['read']['sessionId'],
  ): Promise<TAgentOutputs['chat']['draftManifest']['read']>;
  patchDraftManifestChat(
    widgetId: TAgentInputs['chat']['draftManifest']['patch']['widgetId'],
    sessionId: TAgentInputs['chat']['draftManifest']['patch']['sessionId'],
    patch: TAgentInputs['chat']['draftManifest']['patch']['patch'],
  ): Promise<TAgentOutputs['chat']['draftManifest']['patch']>;
  inspectDraftActorChat(
    widgetId: TAgentInputs['chat']['draftActor']['inspect']['widgetId'],
    sessionId: TAgentInputs['chat']['draftActor']['inspect']['sessionId'],
  ): TAgentOutputs['chat']['draftActor']['inspect'];
  startDraftActorChat(
    widgetId: TAgentInputs['chat']['draftActor']['start']['widgetId'],
    sessionId: TAgentInputs['chat']['draftActor']['start']['sessionId'],
  ): Promise<TAgentOutputs['chat']['draftActor']['start']>;
  reloadDraftActorChat(
    widgetId: TAgentInputs['chat']['draftActor']['reload']['widgetId'],
    sessionId: TAgentInputs['chat']['draftActor']['reload']['sessionId'],
  ): Promise<TAgentOutputs['chat']['draftActor']['reload']>;
  resetDraftActorChat(
    widgetId: TAgentInputs['chat']['draftActor']['reset']['widgetId'],
    sessionId: TAgentInputs['chat']['draftActor']['reset']['sessionId'],
  ): Promise<TAgentOutputs['chat']['draftActor']['reset']>;
  stopDraftActorChat(
    widgetId: TAgentInputs['chat']['draftActor']['stop']['widgetId'],
    sessionId: TAgentInputs['chat']['draftActor']['stop']['sessionId'],
  ): TAgentOutputs['chat']['draftActor']['stop'];
  sendDraftActorChat(
    widgetId: TAgentInputs['chat']['draftActor']['send']['widgetId'],
    sessionId: TAgentInputs['chat']['draftActor']['send']['sessionId'],
    name: TAgentInputs['chat']['draftActor']['send']['name'],
    payload: TAgentInputs['chat']['draftActor']['send']['payload'],
  ): TAgentOutputs['chat']['draftActor']['send'];

  listWidgetDrafts(): Promise<TAgentOutputs['widgetDraft']['list']>;
  getWidgetDraft(
    draftId: TAgentInputs['widgetDraft']['get']['draftId'],
  ): Promise<TAgentOutputs['widgetDraft']['get']>;
  validateWidgetDraft(
    draftId: TAgentInputs['widgetDraft']['validate']['draftId'],
    expectedRevision: TAgentInputs['widgetDraft']['validate']['expectedRevision'],
  ): Promise<TAgentOutputs['widgetDraft']['validate']>;

  getWidgetPreview(
    draftId: TAgentInputs['widgetPreview']['get']['draftId'],
    previewId: TAgentInputs['widgetPreview']['get']['previewId'],
  ): Promise<TAgentOutputs['widgetPreview']['get']>;
  buildWidgetPreview(
    draftId: TAgentInputs['widgetPreview']['build']['draftId'],
    previewId: TAgentInputs['widgetPreview']['build']['previewId'],
    expectedRevision: TAgentInputs['widgetPreview']['build']['expectedRevision'],
  ): Promise<TAgentOutputs['widgetPreview']['build']>;
  refreshWidgetPreview(
    draftId: TAgentInputs['widgetPreview']['refresh']['draftId'],
    previewId: TAgentInputs['widgetPreview']['refresh']['previewId'],
    expectedRevision: TAgentInputs['widgetPreview']['refresh']['expectedRevision'],
  ): Promise<TAgentOutputs['widgetPreview']['refresh']>;
  resetWidgetPreview(
    draftId: TAgentInputs['widgetPreview']['reset']['draftId'],
    previewId: TAgentInputs['widgetPreview']['reset']['previewId'],
    expectedRevision: TAgentInputs['widgetPreview']['reset']['expectedRevision'],
  ): Promise<TAgentOutputs['widgetPreview']['reset']>;
  closeWidgetPreview(
    draftId: TAgentInputs['widgetPreview']['close']['draftId'],
    previewId: TAgentInputs['widgetPreview']['close']['previewId'],
    expectedRevision: TAgentInputs['widgetPreview']['close']['expectedRevision'],
  ): Promise<TAgentOutputs['widgetPreview']['close']>;
  sendWidgetPreview(
    draftId: TAgentInputs['widgetPreview']['send']['draftId'],
    previewId: TAgentInputs['widgetPreview']['send']['previewId'],
    expectedRevision: TAgentInputs['widgetPreview']['send']['expectedRevision'],
    name: TAgentInputs['widgetPreview']['send']['name'],
    payload: TAgentInputs['widgetPreview']['send']['payload'],
  ): Promise<TAgentOutputs['widgetPreview']['send']>;
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
    previewId?: TAgentInputs['widgets']['resolvePlacement']['previewId'],
  ): Promise<TAgentOutputs['widgets']['resolvePlacement']>;

  login(providerId: TAgentInputs['auth']['login']['providerId']): TAgentOutputs['auth']['login']['loginId'];
  logout(providerId: TAgentInputs['auth']['logout']['providerId']): void;
  getLoginStatus(loginId: TAgentInputs['auth']['status']['loginId']): TAgentOutputs['auth']['status'];
  abortLogin(loginId: TAgentInputs['auth']['abort']['loginId']): void;
  setApiKey(
    providerId: TAgentInputs['auth']['apiKey']['set']['providerId'],
    key: TAgentInputs['auth']['apiKey']['set']['key'],
  ): void;
  removeApiKey(providerId: TAgentInputs['auth']['apiKey']['remove']['providerId']): void;
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
