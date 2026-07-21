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

const fakeActorCapability = {
  deleteDefinition: unusedCapability,
  getVibecanvasJson: unusedCapability,
  getWidgetCode: unusedCapability,
  sendMessage: unusedCapability,
} satisfies TApiContext['actor'];

const fakeResourceCapability = {
  bindResource: unusedCapability,
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
  getDefinitionResourceStatus: unusedCapability,
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
  unbindResource: unusedCapability,
  updateDbRow: unusedCapability,
} satisfies TApiContext['resource'];

const fakeHumanResourceSecretCapability = {
  revealSecret: unusedCapability,
} satisfies TApiContext['humanResourceSecret'];

const fakeAgentCapability = {
  abortLogin: unusedCapability,
  approveChatDbChange: unusedCapability,
  buildWidgetPreview: unusedCapability,
  cancelChat: unusedCapability,
  clearDraftResourceBindingsChat: unusedCapability,
  closeWidgetPreview: unusedCapability,
  connectChat: unusedCapability,
  deleteWidget: unusedCapability,
  ensureWidgetDraft: unusedCapability,
  getChatApproval: unusedCapability,
  getLoginStatus: unusedCapability,
  getWidgetCatalog: unusedCapability,
  getWidgetDetail: unusedCapability,
  getWidgetDraft: unusedCapability,
  getWidgetPreview: unusedCapability,
  inspectDraftActorChat: unusedCapability,
  listChatApprovals: unusedCapability,
  listWidgetDrafts: unusedCapability,
  listWidgetFiles: unusedCapability,
  login: unusedCapability,
  logout: unusedCapability,
  newChatSession: unusedCapability,
  patchDraftManifestChat: unusedCapability,
  patchWidgetDraftMetadata: unusedCapability,
  patchWidgetDraftTool: unusedCapability,
  previewSourceChat: unusedCapability,
  promptChat: unusedCapability,
  publishChat: unusedCapability,
  publishWidgetDraft: unusedCapability,
  readDraftManifestChat: unusedCapability,
  readWidgetFile: unusedCapability,
  refreshWidgetPreview: unusedCapability,
  rejectChatDbChange: unusedCapability,
  reloadDraftActorChat: unusedCapability,
  removeApiKey: unusedCapability,
  resetDraftActorChat: unusedCapability,
  resetWidgetPreview: unusedCapability,
  resolveChatApproval: unusedCapability,
  resolveWidgetPlacement: unusedCapability,
  sendDraftActorChat: unusedCapability,
  sendWidgetPreview: unusedCapability,
  setApiKey: unusedCapability,
  settings: unusedCapability,
  startDraftActorChat: unusedCapability,
  startWidgetEditChat: unusedCapability,
  stopDraftActorChat: unusedCapability,
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
  actor: fakeActorCapability,
  agent: fakeAgentCapability,
  automerge: fakeCapability<TApiContext['automerge']>(),
  db: {
    actor: fakeCapability<TApiContext['db']['actor']>(),
    canvas: fakeCapability<TApiContext['db']['canvas']>(),
    file: fakeCapability<TApiContext['db']['file']>(),
    filesystem: {
      listAll: async () => [],
    },
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
    subscribeActorEvents: async function* () {},
    subscribeAgentEvents: async function* () {},
    subscribeDbEventRecords: async function* () {},
    subscribeNotificationRecords: async function* () {},
  },
  filesystem: fakeCapability<TApiContext['filesystem']>(),
  humanResourceSecret: fakeHumanResourceSecretCapability,
  pty: fakeCapability<TApiContext['pty']>(),
  resource: fakeResourceCapability,
} satisfies TApiContext;

describe('API context composition', () => {
  test('boots the complete router from structural fake capabilities', () => {
    const composed = implement(apiContract)
      .$context<TApiContext>()
      .router(router);

    expect(Object.keys(composed.api)).toEqual([
      'actors',
      'agent',
      'canvas',
      'db',
      'file',
      'filesystem',
      'notification',
      'pty',
      'resource',
      'tool',
    ]);
  });

  test('runs a handler using only its narrow fake database capability', async () => {
    const listToolGroups = router.api.tool.groups.list.callable({ context: fakeContext });

    await expect(listToolGroups()).resolves.toEqual([
      { name: 'Fake tools', json: null },
    ]);
  });
});
