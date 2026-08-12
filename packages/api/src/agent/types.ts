import type {
  InferContractRouterInputs,
  InferContractRouterOutputs,
} from '@orpc/contract';
import type { agentContract, TAgentEvent } from './contract';

type TAgentInputs = InferContractRouterInputs<typeof agentContract>;
type TAgentOutputs = InferContractRouterOutputs<typeof agentContract>;

type TAgentPromptInput = TAgentInputs['chat']['prompt'];
type TAgentPromptSelection = Pick<
  TAgentPromptInput,
  'canvasId' | 'images' | 'model' | 'thinkingLevel' | 'widgetRefs'
>;
type TAgentEditInput = TAgentInputs['chat']['edit'];
type TAgentEditSelection = Pick<TAgentEditInput, 'canvasId' | 'model' | 'thinkingLevel'>;

/** Chat/auth capability only. Widget authoring is filesystem-owned under `api.widget`. */
export type TAgentApiCapability = {
  settings(): Promise<TAgentOutputs['settings']['get']>;
  updateApprovalPolicy(
    policy: TAgentInputs['settings']['approvalPolicy']['update'],
  ): Promise<TAgentOutputs['settings']['approvalPolicy']['update']>;
  connectChat(
    widgetId: TAgentInputs['chat']['connect']['widgetId'],
    sessionId: TAgentInputs['chat']['connect']['sessionId'],
    canvasId: TAgentInputs['chat']['connect']['canvasId'],
    mode?: NonNullable<TAgentInputs['chat']['connect']['mode']>,
  ): Promise<TAgentOutputs['chat']['connect']>;
  getChatHistory(
    widgetId: TAgentInputs['chat']['history']['widgetId'],
    sessionId: TAgentInputs['chat']['history']['sessionId'],
  ): TAgentOutputs['chat']['history'];
  promptChat(
    widgetId: TAgentPromptInput['widgetId'],
    sessionId: TAgentPromptInput['sessionId'],
    text: TAgentPromptInput['text'],
    selection?: TAgentPromptSelection,
  ): Promise<void>;
  editChatMessage(
    widgetId: TAgentEditInput['widgetId'],
    sessionId: TAgentEditInput['sessionId'],
    entryId: TAgentEditInput['entryId'],
    text: TAgentEditInput['text'],
    selection?: TAgentEditSelection,
  ): Promise<TAgentOutputs['chat']['edit']>;
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
  ): Promise<TAgentOutputs['chat']['approval']['resolve']>;
  cancelChat(
    widgetId: TAgentInputs['chat']['cancel']['widgetId'],
    sessionId: TAgentInputs['chat']['cancel']['sessionId'],
  ): Promise<TAgentOutputs['chat']['cancel']>;
  newChatSession(
    widgetId: TAgentInputs['chat']['newSession']['widgetId'],
    sessionId: TAgentInputs['chat']['newSession']['sessionId'],
  ): Promise<void>;
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
  publishAgentEvent(event: TAgentEvent): number;
  subscribeAgentEvents(): AsyncIterable<TAgentEvent>;
};

export type TAgentApiContext = {
  eventPublisher: TAgentEventCapability;
  agent: TAgentApiCapability;
};
