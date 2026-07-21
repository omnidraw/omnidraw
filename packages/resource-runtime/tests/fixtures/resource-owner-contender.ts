import { claimResourceOwner } from '../../src/local/ResourceOwnerLock';

const root = process.argv[2];
const ownerId = process.argv[3];
if (!root || !ownerId) throw new Error('Resource owner contender requires root and owner ID.');

try {
  const lease = await claimResourceOwner({ root, ownerId });
  process.stdout.write(`${JSON.stringify({ status: 'won', ownerId, pid: process.pid })}\n`);
  for await (const _chunk of Bun.stdin.stream()) break;
  await lease.release();
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    status: 'rejected',
    ownerId,
    code: error instanceof Error && 'code' in error ? error.code : null,
  })}\n`);
}
