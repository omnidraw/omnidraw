import { describe, expect, test } from 'bun:test';
import { AgentService } from '../src/AgentService';
import { txAppendWidgetDbChangeProposalRecord } from '../src/core/tx.session-records';
import { createFakeSessionManager } from './tool.test-helpers';

const proposal = {
  id: 'proposal-1',
  resourceId: 'db-1',
  resourceName: 'Notes Database',
  sql: 'ALTER TABLE notes ADD COLUMN title TEXT;',
  reason: 'Store note titles.',
  status: 'pending' as const,
  proposedAt: '2026-01-01T00:00:00.000Z',
};

function createService(actorService: ConstructorParameters<typeof AgentService>[0]['actorService']) {
  const service = new AgentService({
    cachePath: '/tmp/cache',
    dataPath: '/tmp/data',
    configPath: '/tmp/config',
    eventPublisherService: {} as never,
    actorService,
  });
  const sessionManager = createFakeSessionManager();
  txAppendWidgetDbChangeProposalRecord({ sessionManager }, proposal);
  service.sessionMap.widget = {
    session: {
      unsub: () => {},
      sessionManager: sessionManager as never,
      session: {} as never,
    },
  };
  return service;
}

describe('AgentService database change approval', () => {
  test('executes only through explicit approval and records the coordinated apply', async () => {
    const calls: string[] = [];
    const service = createService({
      reload: async () => {},
      createDbDraft: async () => { calls.push('create'); return { draft: { id: 'draft-1' } }; },
      executeDbDraftSql: async (_draftId, sql) => { calls.push(`execute:${sql}`); },
      discardDbDraft: async () => { calls.push('discard'); },
      previewDbApply: async () => { calls.push('preview'); return { warnings: ['Review compatibility.'] }; },
      confirmDbApply: async () => {
        calls.push('confirm');
        return {
          id: 'apply-1', resource_id: 'db-1', draft_id: 'draft-1', source_apply_id: null,
          status: 'applying', last_error: null, backup_retained: false,
          created_at: '2026-01-01T00:00:00.000Z', completed_at: null,
        };
      },
    });

    const result = await service.approveChatDbChange('widget', 'session', 'proposal-1');
    expect(calls).toEqual(['create', `execute:${proposal.sql}`, 'preview', 'confirm']);
    expect(result).toMatchObject({ status: 'approved', draftId: 'draft-1', applyId: 'apply-1' });
    await expect(service.approveChatDbChange('widget', 'session', 'proposal-1')).rejects.toThrow('already approved');
  });

  test('discards a created draft when SQL validation or apply preparation fails', async () => {
    const calls: string[] = [];
    const service = createService({
      reload: async () => {},
      createDbDraft: async () => { calls.push('create'); return { draft: { id: 'draft-1' } }; },
      executeDbDraftSql: async () => { calls.push('execute'); throw new Error('invalid SQL'); },
      discardDbDraft: async (draftId) => { calls.push(`discard:${draftId}`); },
      previewDbApply: async () => ({ warnings: [] }),
      confirmDbApply: async () => { throw new Error('not reached'); },
    });

    await expect(service.approveChatDbChange('widget', 'session', 'proposal-1')).rejects.toThrow('invalid SQL');
    expect(calls).toEqual(['create', 'execute', 'discard:draft-1']);
  });

  test('does not let another approval or rejection race a claimed proposal', async () => {
    const calls: string[] = [];
    let releaseDraftCreation = () => {};
    let reportDraftCreationStarted = () => {};
    const draftCreationBlocked = new Promise<void>((resolve) => { releaseDraftCreation = resolve; });
    const draftCreationStarted = new Promise<void>((resolve) => { reportDraftCreationStarted = resolve; });
    const service = createService({
      reload: async () => {},
      createDbDraft: async () => {
        calls.push('create');
        reportDraftCreationStarted();
        await draftCreationBlocked;
        return { draft: { id: 'draft-1' } };
      },
      executeDbDraftSql: async () => { calls.push('execute'); },
      discardDbDraft: async () => { calls.push('discard'); },
      previewDbApply: async () => { calls.push('preview'); return { warnings: [] }; },
      confirmDbApply: async () => {
        calls.push('confirm');
        return {
          id: 'apply-1', resource_id: 'db-1', draft_id: 'draft-1', source_apply_id: null,
          status: 'applying', last_error: null, backup_retained: false,
          created_at: '2026-01-01T00:00:00.000Z', completed_at: null,
        };
      },
    });

    const approving = service.approveChatDbChange('widget', 'session', 'proposal-1');
    await draftCreationStarted;
    await expect(service.approveChatDbChange('widget', 'session', 'proposal-1')).rejects.toThrow('being resolved');
    let rejectError: unknown;
    try {
      service.rejectChatDbChange('widget', 'session', 'proposal-1');
    } catch (error) {
      rejectError = error;
    } finally {
      releaseDraftCreation();
    }

    const approved = await approving;
    expect(rejectError).toBeInstanceOf(Error);
    expect((rejectError as Error).message).toContain('being resolved');
    expect(approved.status).toBe('approved');
    expect(calls).toEqual(['create', 'execute', 'preview', 'confirm']);
  });
});
