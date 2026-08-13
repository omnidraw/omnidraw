import { describe, expect, test } from 'bun:test';
import {
  ZDbResourceApplyRun,
  ZDbResourceDraft,
  ZDbResourceDraftChange,
} from '../model';

describe('resource control models', () => {
  const timestamps = {
    createdAtSec: '2026-01-01 00:00:00',
    updatedAtSec: '2026-01-01 00:00:00',
  };

  test('parses neutral draft and apply rows', () => {
    expect(ZDbResourceDraft.safeParse({
      id: 'draft', resourceId: 'resource', name: 'Add notes', status: 'editing',
      lastError: null, ...timestamps, appliedAtSec: null,
    }).success).toBe(true);
    expect(ZDbResourceDraftChange.safeParse({
      draftId: 'draft', sequence: 1, kind: 'structure',
      operation: { type: 'createTable', table: 'notes' },
      sql: 'CREATE TABLE notes (id TEXT);', createdAtSec: timestamps.createdAtSec,
    }).success).toBe(true);
    expect(ZDbResourceApplyRun.parse({
      id: 'apply', resourceId: 'resource', draftId: 'draft', sourceApplyId: null,
      status: 'applying', lastError: null, backupRetained: 1,
      createdAtSec: timestamps.createdAtSec, completedAtSec: null,
    })).toMatchObject({ backupRetained: true, status: 'applying' });
  });

  test('rejects invalid versions and removed lifecycle values', () => {
    expect(ZDbResourceDraftChange.safeParse({
      draftId: 'draft', sequence: 0, kind: 'structure', operation: null,
      sql: 'SELECT 1', createdAtSec: timestamps.createdAtSec,
    }).success).toBe(false);
    expect(ZDbResourceApplyRun.safeParse({
      id: 'apply', resourceId: 'resource', draftId: 'draft', sourceApplyId: null,
      status: 'restarting', lastError: null, backupRetained: 0,
      createdAtSec: timestamps.createdAtSec, completedAtSec: null,
    }).success).toBe(false);
  });
});
