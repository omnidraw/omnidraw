import { describe, expect, test } from 'bun:test';
import { implement } from '@orpc/server';
import { fnFreezeTenantContext } from '@vibecanvas/tenant-core';
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
  listResourceReferences: unusedCapability,
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
  buildWidgetPreview: unusedCapability,
  acquireWidgetPreviewMountLease: unusedCapability,
  renewWidgetPreviewMountLease: unusedCapability,
  releaseWidgetPreviewMountLease: unusedCapability,
  reportWidgetPreviewDiagnostic: unusedCapability,
  getWidgetPreviewDiagnostics: unusedCapability,
  retestWidgetPreviewDiagnostic: unusedCapability,
  resolveWidgetPreviewDiagnostic: unusedCapability,
  cancelWidgetPreviewBuild: unusedCapability,
  cancelChat: unusedCapability,
  clearDraftResourceBindingsChat: unusedCapability,
  connectChat: unusedCapability,
  deleteWidget: unusedCapability,
  ensureWidgetDraft: unusedCapability,
  ensureWidgetPreviewOwner: unusedCapability,
  getChatApproval: unusedCapability,
  getLoginStatus: unusedCapability,
  getWidgetCatalog: unusedCapability,
  getWidgetDetail: unusedCapability,
  getWidgetDraft: unusedCapability,
  getWidgetPreviewOwner: unusedCapability,
  listChatApprovals: unusedCapability,
  listWidgetDrafts: unusedCapability,
  listWidgetFiles: unusedCapability,
  listWidgetPreviewOwners: unusedCapability,
  login: unusedCapability,
  logout: unusedCapability,
  newChatSession: unusedCapability,
  patchWidgetDraftMetadata: unusedCapability,
  patchWidgetDraftTool: unusedCapability,
  promptChat: unusedCapability,
  publishWidgetDraft: unusedCapability,
  readWidgetFile: unusedCapability,
  rejectChatDbChange: unusedCapability,
  removeApiKey: unusedCapability,
  closeWidgetPreviewOwner: unusedCapability,
  resolveChatApproval: unusedCapability,
  resolveWidgetPlacement: unusedCapability,
  setApiKey: unusedCapability,
  settings: unusedCapability,
  validateWidgetDraft: unusedCapability,
} satisfies TApiContext['agent'];

const tenant = fnFreezeTenantContext({
  orgId: 'fake-org',
  accountId: 'fake-account',
  cellId: 'fake-cell',
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'fake-request',
});

const fakeContext = {
  tenant,
  agent: fakeAgentCapability,
  canvas: fakeCapability<TApiContext['canvas']>(),
  db: {
    canvas: fakeCapability<TApiContext['db']['canvas']>(),
    file: fakeCapability<TApiContext['db']['file']>(),
    toolGroup: {
      create: async (_tenant, group) => group,
      getByName: async () => null,
      listAll: async () => [{ name: 'Fake tools', json: null }],
      remove: async () => null,
      update: async (_tenant, group) => ({ name: group.name, json: group.json }),
    },
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
  widget: fakeCapability<TApiContext['widget']>(),
  widgetState: fakeCapability<TApiContext['widgetState']>(),
  widgetCapsuleHostConfiguration:
    fakeCapability<TApiContext['widgetCapsuleHostConfiguration']>(),
  widgetRuntimeLoadAdmission: {
    run: async (_tenant, signal, operation) => await operation(
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
      'tool',
      'widget',
    ]);
  });

  test('runs a handler using only its narrow fake database capability', async () => {
    const listToolGroups = router.api.tool.groups.list.callable({ context: fakeContext });

    await expect(listToolGroups()).resolves.toEqual([
      { name: 'Fake tools', json: null },
    ]);
  });
});
