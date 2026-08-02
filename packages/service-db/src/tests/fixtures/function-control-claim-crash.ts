import { fnFreezeTenantContext } from '@omnidraw/tenant-core';
import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '../../CONSTANTS';
import { Database } from '../../DbServiceTurso/turso-native';
import { FunctionControlStoreTurso } from '../../FunctionControlStoreTurso';

const databasePath = Bun.argv[2];
const invocationId = Bun.argv[3];
const attemptId = Bun.argv[4];
const canvasId = Bun.argv[5];

if (!databasePath || !invocationId || !attemptId || !canvasId) {
  throw new Error('Expected database path, invocation id, attempt id, and canvas id.');
}

const database = new Database(databasePath, {
  experimental: ['custom_types', 'triggers', 'index_method', 'generated_columns', 'multiprocess_wal'],
});
await database.connect();
const tenant = fnFreezeTenantContext({
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: 'function-test-cell',
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'function-control-test',
  canvasId,
});
const store = new FunctionControlStoreTurso(database);
const claimed = await store.claim(tenant, {
  invocationId,
  attemptId,
  workerId: 'crash-worker',
  sandboxDriver: 'bun-child',
  coldStart: true,
  nowMs: 110,
  ttlMs: 10,
});
if (claimed.status !== 'claimed') throw new Error(`Claim failed: ${claimed.reason}`);
process.stdout.write(`${JSON.stringify({
  type: 'function-claim-committed',
  invocationId,
  attemptId,
  leaseEpoch: claimed.lease.leaseEpoch,
})}\n`);
await new Promise<never>(() => undefined);
