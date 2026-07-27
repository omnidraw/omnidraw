#!/usr/bin/env bun

/**
 * @file Writes and fsyncs one immutable blob, reports the durable checkpoint,
 * then parks before any control-store metadata can be committed.
 */

import { LocalWidgetArtifactStore } from '../../src/local';

const artifactsRoot = Bun.argv[2];
const orgId = Bun.argv[3];

if (!artifactsRoot || !orgId) {
  throw new Error('Expected an artifact root and organization id.');
}

const bytes = new TextEncoder().encode('durable orphan written before metadata');
const blobs = new LocalWidgetArtifactStore({
  orgId,
  artifactsRoot,
  createNonce: () => 'crash-checkpoint',
});
const stored = await blobs.writeArtifact({ kind: 'ui', bytes });

process.stdout.write(`${JSON.stringify({
  type: 'widget-artifact-fsync-checkpoint',
  pid: process.pid,
  digestSha256: stored.digestSha256,
  byteSize: stored.byteSize,
})}\n`);

await new Promise<never>(() => undefined);
