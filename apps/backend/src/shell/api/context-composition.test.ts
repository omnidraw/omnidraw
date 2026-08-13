import { describe, expect, test } from 'bun:test';
import { implement } from './procedure';
import { apiContract } from './contract';
import type { TApiContext } from './context';
import { router } from './router';

function fakeCapability<T extends object>(): T {
  return new Proxy({}, {
    get: () => () => {
      throw new Error('Unused fake capability method');
    },
  }) as T;
}

function unusedCapability(): never {
  throw new Error('Unused fake capability method');
}

const fakeResourceCapability = {
  bulkDbRows: unusedCapability,
  changeDbDraft: unusedCapability,
  confirmDbApply: unusedCapability,
  createDbDraft: unusedCapability,
  createDbRow: unusedCapability,
  createResource: unusedCapability,
  dbResourceImpact: unusedCapability,
  deleteDbRow: unusedCapability,
  deleteResource: unusedCapability,
  deleteResourceDataEntry: unusedCapability,
  discardDbBackup: unusedCapability,
  discardDbDraft: unusedCapability,
  executeDbDraftSql: unusedCapability,
  executeDbLiveSql: unusedCapability,
  getActiveDbDraft: unusedCapability,
  getDbApply: unusedCapability,
  getDbBackup: unusedCapability,
  getDbDraft: unusedCapability,
  getDbRestoreStatus: unusedCapability,
  getDbRow: unusedCapability,
  getResource: unusedCapability,
  inspectDbResource: unusedCapability,
  listDbApplies: unusedCapability,
  listDbDrafts: unusedCapability,
  listDbRows: unusedCapability,
  listResourceData: unusedCapability,
  listResources: unusedCapability,
  previewDbApply: unusedCapability,
  previewDbBackupRestore: unusedCapability,
  renameResource: unusedCapability,
  restoreDbBackup: unusedCapability,
  setResourceDataEntry: unusedCapability,
  updateDbRow: unusedCapability,
} satisfies TApiContext['resource'];

const fakeHumanResourceSecretCapability = {
  revealSecret: unusedCapability,
} satisfies TApiContext['humanResourceSecret'];

const fakeAgentCapability = {
  abortLogin: unusedCapability,
  approveChatDbChange: unusedCapability,
  cancelChat: unusedCapability,
  connectChat: unusedCapability,
  getChatApproval: unusedCapability,
  getChatHistory: unusedCapability,
  getLoginStatus: unusedCapability,
  listChatApprovals: unusedCapability,
  login: unusedCapability,
  logout: unusedCapability,
  editChatMessage: unusedCapability,
  newChatSession: unusedCapability,
  promptChat: unusedCapability,
  rejectChatDbChange: unusedCapability,
  removeApiKey: unusedCapability,
  resolveChatApproval: unusedCapability,
  setApiKey: unusedCapability,
  settings: unusedCapability,
  updateApprovalPolicy: unusedCapability,
} satisfies TApiContext['agent'];

const fakeContext = {
  agent: fakeAgentCapability,
  canvas: fakeCapability<TApiContext['canvas']>(),
  db: {
    canvas: fakeCapability<TApiContext['db']['canvas']>(),
    file: fakeCapability<TApiContext['db']['file']>(),
  },
  eventPublisher: {
    publishAgentEvent: () => 1,
    subscribeAgentEvents: async function* () {},
    subscribeDbEventRecords: async function* () {},
    subscribeNotificationRecords: async function* () {},
  },
  functionInvocation: fakeCapability<TApiContext['functionInvocation']>(),
  humanResourceSecret: fakeHumanResourceSecretCapability,
  resource: fakeResourceCapability,
  widgetCatalog: fakeCapability<TApiContext['widgetCatalog']>(),
  widgetPreview: fakeCapability<TApiContext['widgetPreview']>(),
  widgetState: fakeCapability<TApiContext['widgetState']>(),
  widgetCapsuleHostConfiguration:
    fakeCapability<TApiContext['widgetCapsuleHostConfiguration']>(),
  widgetRuntimeLoadAdmission: {
    run: (signal, operation) => operation(
      signal ?? new AbortController().signal,
      (cleanup) => {
        try {
          void cleanup().catch(() => undefined);
        } catch {
          // The production admission service observes cleanup failures.
        }
      },
    ),
  },
} satisfies TApiContext;

describe('API context composition', () => {
  test('boots the complete router from structural fake capabilities', () => {
    const composed = implement(apiContract)
      .$context<TApiContext>()
      .router(router);

    expect(Object.keys(composed.api)).toEqual([
      'agent',
      'canvas',
      'db',
      'file',
      'function',
      'notification',
      'resource',
      'widget',
    ]);
  });
});
