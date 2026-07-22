import { describe, expect, test } from 'bun:test';
import {
  ZDbResourceApplyRun,
  ZDbResourceDraft,
  ZDbResourceDraftChange,
} from '../model';

describe('resource control models', () => {
  const timestamps = {
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
  };

  test('parses neutral draft and apply rows', () => {
    expect(ZDbResourceDraft.safeParse({
      id: 'draft', resource_id: 'resource', name: 'Add notes', status: 'editing',
      last_error: null, ...timestamps, applied_at: null,
    }).success).toBe(true);
    expect(ZDbResourceDraftChange.safeParse({
      draft_id: 'draft', sequence: 1, kind: 'structure',
      operation: { type: 'createTable', table: 'notes' },
      sql: 'CREATE TABLE notes (id TEXT);', created_at: timestamps.created_at,
    }).success).toBe(true);
    expect(ZDbResourceApplyRun.parse({
      id: 'apply', resource_id: 'resource', draft_id: 'draft', source_apply_id: null,
      status: 'applying', last_error: null, backup_retained: 1,
      created_at: timestamps.created_at, completed_at: null,
    })).toMatchObject({ backup_retained: true, status: 'applying' });
  });

  test('rejects invalid versions and removed lifecycle values', () => {
    expect(ZDbResourceDraftChange.safeParse({
      draft_id: 'draft', sequence: 0, kind: 'structure', operation: null,
      sql: 'SELECT 1', created_at: timestamps.created_at,
    }).success).toBe(false);
    expect(ZDbResourceApplyRun.safeParse({
      id: 'apply', resource_id: 'resource', draft_id: 'draft', source_apply_id: null,
      status: 'restarting', last_error: null, backup_retained: 0,
      created_at: timestamps.created_at, completed_at: null,
    }).success).toBe(false);
  });
});
