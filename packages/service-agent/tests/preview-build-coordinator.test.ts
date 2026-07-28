import { describe, expect, test } from 'bun:test';
import {
  PreviewBuildCoordinator,
  type TPreviewBuildOutcome,
} from '../src/widget-drafts/PreviewBuildCoordinator';

type TScheduled = {
  cancelled: boolean;
  callback(): void;
};

const SOURCE_FENCE = Object.freeze({
  sourceDigestSha256: 'a'.repeat(64),
  committedMutationId: 'mutation-1',
  buildSequence: 1,
});

function harness<TResult>() {
  const scheduled: TScheduled[] = [];
  const coordinator = new PreviewBuildCoordinator<TResult>({
    debounceMs: 250,
    scheduleTimeout(callback) {
      const timer = { cancelled: false, callback };
      scheduled.push(timer);
      return timer;
    },
    cancelTimeout(timer) {
      (timer as TScheduled).cancelled = true;
    },
  });
  return {
    coordinator,
    flushNext() {
      const timer = scheduled.find((candidate) => !candidate.cancelled);
      if (!timer) throw new Error('No scheduled Preview build is available.');
      timer.cancelled = true;
      timer.callback();
    },
  };
}

function deferred<TResult>() {
  let resolve!: (result: TResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<TResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('PreviewBuildCoordinator', () => {
  test('deduplicates an in-flight build and reuses the last-good build key', async () => {
    const { coordinator, flushNext } = harness<string>();
    let calls = 0;
    const request = {
      draftId: 'draft-1',
      buildKey: 'key-1',
      ...SOURCE_FENCE,
      build: async () => {
        calls += 1;
        return 'artifact-1';
      },
    };

    const first = coordinator.request(request);
    const duplicate = coordinator.request(request);
    expect(duplicate).toBe(first);
    flushNext();
    await expect(first).resolves.toMatchObject({
      status: 'ready',
      buildSequence: 1,
      reused: false,
      result: 'artifact-1',
    });
    await expect(coordinator.request(request)).resolves.toMatchObject({
      status: 'ready',
      buildSequence: 1,
      reused: true,
      result: 'artifact-1',
    });
    expect(calls).toBe(1);
  });

  test('does not reuse a build key across committed mutation fences', async () => {
    const { coordinator, flushNext } = harness<string>();
    let calls = 0;
    const build = async () => `artifact-${++calls}`;
    const first = coordinator.request({
      draftId: 'draft-1',
      buildKey: 'key-1',
      ...SOURCE_FENCE,
      build,
    });
    flushNext();
    await expect(first).resolves.toMatchObject({
      status: 'ready',
      committedMutationId: SOURCE_FENCE.committedMutationId,
      reused: false,
    });

    const second = coordinator.request({
      draftId: 'draft-1',
      buildKey: 'key-1',
      sourceDigestSha256: SOURCE_FENCE.sourceDigestSha256,
      committedMutationId: 'mutation-2',
      buildSequence: 2,
      build,
    });
    flushNext();
    await expect(second).resolves.toMatchObject({
      status: 'ready',
      buildSequence: 2,
      sourceDigestSha256: SOURCE_FENCE.sourceDigestSha256,
      committedMutationId: 'mutation-2',
      reused: false,
      result: 'artifact-2',
    });
    expect(calls).toBe(2);
  });

  test('rejects a cross-digest mutation fence at one durable build sequence', () => {
    const { coordinator } = harness<string>();
    coordinator.request({
      draftId: 'draft-1',
      buildKey: 'key-1',
      ...SOURCE_FENCE,
      build: async () => 'artifact-1',
    });

    expect(() => coordinator.request({
      draftId: 'draft-1',
      buildKey: 'key-2',
      sourceDigestSha256: 'b'.repeat(64),
      committedMutationId: SOURCE_FENCE.committedMutationId,
      buildSequence: SOURCE_FENCE.buildSequence,
      build: async () => 'artifact-2',
    })).toThrow('cannot identify multiple source mutation fences');
  });

  test('supersedes running work immediately and fences its late completion', async () => {
    const { coordinator, flushNext } = harness<string>();
    const firstBuild = deferred<string>();
    const secondBuild = deferred<string>();
    let firstSignal: AbortSignal | undefined;
    const progress: string[] = [];
    coordinator.subscribe((event) => {
      progress.push(`${event.buildSequence}:${event.phase}`);
    });

    const first = coordinator.request({
      draftId: 'draft-1',
      buildKey: 'key-1',
      ...SOURCE_FENCE,
      async build({ signal }) {
        firstSignal = signal;
        return firstBuild.promise;
      },
    });
    flushNext();
    const second = coordinator.request({
      draftId: 'draft-1',
      buildKey: 'key-2',
      ...SOURCE_FENCE,
      build: () => secondBuild.promise,
    });

    await expect(first).resolves.toMatchObject({
      status: 'superseded',
      buildSequence: 1,
    });
    expect(firstSignal?.aborted).toBe(true);
    flushNext();
    secondBuild.resolve('artifact-2');
    await expect(second).resolves.toMatchObject({
      status: 'ready',
      buildSequence: 1,
      result: 'artifact-2',
    });
    firstBuild.resolve('obsolete-artifact');
    await Promise.resolve();
    expect(coordinator.lastGood('draft-1')).toMatchObject({
      buildKey: 'key-2',
      buildSequence: 1,
      result: 'artifact-2',
    });
    expect(progress).toEqual([
      '1:queued',
      '1:building',
      '1:superseded',
      '1:queued',
      '1:building',
      '1:ready',
    ]);
  });

  test('retains last-good when a forced replacement fails', async () => {
    const { coordinator, flushNext } = harness<string>();
    const initial = coordinator.request({
      draftId: 'draft-1',
      buildKey: 'key-1',
      ...SOURCE_FENCE,
      build: async () => 'working-artifact',
    });
    flushNext();
    await initial;

    const replacement = coordinator.request({
      draftId: 'draft-1',
      buildKey: 'key-2',
      ...SOURCE_FENCE,
      build: async () => {
        throw new Error('compile failed');
      },
    });
    flushNext();
    const outcome = await replacement;
    expect(outcome.status).toBe('failed');
    expect((outcome as Extract<TPreviewBuildOutcome<string>, { status: 'failed' }>).lastGood)
      .toMatchObject({
        buildKey: 'key-1',
        result: 'working-artifact',
      });
    expect(coordinator.lastGood('draft-1')?.result).toBe('working-artifact');
  });

  test('clears pending and last-good state for a retired owner', async () => {
    const { coordinator, flushNext } = harness<string>();
    const initial = coordinator.request({
      draftId: 'preview-1',
      buildKey: 'key-1',
      ...SOURCE_FENCE,
      build: async () => 'artifact-1',
    });
    flushNext();
    await initial;

    expect(coordinator.clear('preview-1')).toBe(true);
    expect(coordinator.lastGood('preview-1')).toBeNull();

    const rebuilt = coordinator.request({
      draftId: 'preview-1',
      buildKey: 'key-1',
      ...SOURCE_FENCE,
      build: async () => 'artifact-2',
    });
    flushNext();
    await expect(rebuilt).resolves.toMatchObject({
      status: 'ready',
      buildSequence: 1,
      reused: false,
      result: 'artifact-2',
    });
  });

  test('does not cancel a newer pending sequence through a stale fence', async () => {
    const { coordinator, flushNext } = harness<string>();
    const running = deferred<string>();
    let signal: AbortSignal | undefined;
    const pending = coordinator.request({
      draftId: 'preview-1',
      buildKey: 'key-1',
      ...SOURCE_FENCE,
      async build(context) {
        signal = context.signal;
        return running.promise;
      },
    });
    flushNext();

    expect(coordinator.cancel('preview-1', 2)).toBe(false);
    expect(signal?.aborted).toBe(false);
    expect(coordinator.cancel('preview-1', 1)).toBe(true);
    expect(signal?.aborted).toBe(true);
    await expect(pending).resolves.toMatchObject({
      status: 'superseded',
      buildSequence: 1,
    });
  });

  test('close cancels queued work and rejects new requests', async () => {
    const { coordinator } = harness<string>();
    const queued = coordinator.request({
      draftId: 'draft-1',
      buildKey: 'key-1',
      ...SOURCE_FENCE,
      build: async () => 'never-runs',
    });

    coordinator.close();

    await expect(queued).resolves.toMatchObject({ status: 'superseded' });
    await expect(coordinator.request({
      draftId: 'draft-1',
      buildKey: 'key-2',
      ...SOURCE_FENCE,
      build: async () => 'nope',
    })).rejects.toThrow('closed');
  });
});
