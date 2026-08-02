import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalPolicyStore } from '../src/approval/ApprovalPolicyStore';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('approval policy persistence', () => {
  test('defaults to manual and preserves an explicit reviewer model', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-approval-policy-'));
    roots.push(root);
    const path = join(root, 'settings', 'approval-policy.json');
    const store = new ApprovalPolicyStore(path);
    await expect(store.load()).resolves.toEqual({ mode: 'manual' });

    await store.save({
      mode: 'ai-review',
      reviewerModel: { provider: 'provider-a', modelId: 'model-a' },
    });
    await expect(store.load()).resolves.toEqual({
      mode: 'ai-review',
      reviewerModel: { provider: 'provider-a', modelId: 'model-a' },
    });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      mode: 'ai-review',
      reviewerModel: { provider: 'provider-a', modelId: 'model-a' },
    });
  });

  test('serializes concurrent saves with last-requested policy winning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-approval-policy-'));
    roots.push(root);
    const path = join(root, 'settings', 'approval-policy.json');
    const store = new ApprovalPolicyStore(path);

    await expect(Promise.all([
      store.save({ mode: 'always-approve' }),
      store.save({
        mode: 'ai-review',
        reviewerModel: { provider: 'provider-a', modelId: 'model-a' },
      }),
      store.save({ mode: 'manual' }),
    ])).resolves.toEqual([
      { mode: 'always-approve' },
      {
        mode: 'ai-review',
        reviewerModel: { provider: 'provider-a', modelId: 'model-a' },
      },
      { mode: 'manual' },
    ]);
    await expect(store.load()).resolves.toEqual({ mode: 'manual' });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ mode: 'manual' });
  });
});
