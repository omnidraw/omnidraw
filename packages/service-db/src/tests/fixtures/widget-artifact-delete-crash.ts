#!/usr/bin/env bun

/**
 * @file Deletes a durably tombstoned artifact, reports the post-unlink
 * checkpoint from the directory-sync boundary, then parks before SQL commit.
 */

import { fnFreezeTenantContext } from '@omnidraw/tenant-core';
import {
  LocalWidgetArtifactStore,
  WidgetArtifactGarbageCollector,
  WidgetArtifactOperationLane,
} from '@omnidraw/widget-contract/local';
import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_CELL_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '../../CONSTANTS';
import { DbServiceTurso } from '../../DbServiceTurso/DbServiceTurso';
import { WidgetControlStoreTurso } from '../../WidgetControlStoreTurso';

const databasePath = Bun.argv[2];
const dataDir = Bun.argv[3];
const artifactsRoot = Bun.argv[4];
const artifactId = Bun.argv[5];
if (!databasePath || !dataDir || !artifactsRoot || !artifactId) {
  throw new Error('Expected database, data, artifact root, and artifact id arguments.');
}

const tenant = fnFreezeTenantContext({
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: DEFAULT_OSS_CELL_ID,
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'widget-gc-delete-worker',
});
const service = new DbServiceTurso({
  databasePath,
  dataDir,
  cacheDir: `${dataDir}/cache`,
});
await service.start();
const controlStore = new WidgetControlStoreTurso(service.db);
const blobs = new LocalWidgetArtifactStore({
  orgId: tenant.orgId,
  artifactsRoot,
  syncDirectory: async () => {
    process.stdout.write(`${JSON.stringify({
      type: 'widget-artifact-unlinked',
      pid: process.pid,
      artifactId,
    })}\n`);
    await new Promise<never>(() => undefined);
  },
});
const collector = new WidgetArtifactGarbageCollector({
  controlStore,
  mutationCoordinator: controlStore,
  blobs,
  operationLane: new WidgetArtifactOperationLane(),
});

await collector.collect(tenant, { nowMs: 100, gracePeriodMs: 10, limit: 10 });
