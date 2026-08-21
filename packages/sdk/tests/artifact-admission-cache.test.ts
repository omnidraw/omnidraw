import { afterEach, describe, expect, test } from 'bun:test';
import {
  createArtifactAdmissionCache,
  fnArtifactAdmissionKey,
} from '../src/internal/artifact-admission-cache';
import { SdkEffectRuntime } from '../src/internal/effect-runtime';

const HASH_A = `sha256:${'a'.repeat(64)}` as const;
const HASH_B = `sha256:${'b'.repeat(64)}` as const;

function fakeCache() {
  const values = new Map<string, Uint8Array>();
  let clears = 0;
  return {
    values,
    clears: () => clears,
    async get(hash: `sha256:${string}`) { return values.get(hash)?.slice(); },
    async putVerified(hash: `sha256:${string}`, bytes: Readonly<Uint8Array>) {
      values.set(hash, Uint8Array.from(bytes));
    },
    clear() { clears += 1; values.clear(); },
  };
}

const runtimes = new Set<SdkEffectRuntime>();
function runtime(): SdkEffectRuntime {
  const value = new SdkEffectRuntime();
  runtimes.add(value);
  return value;
}

afterEach(async () => {
  await Promise.all([...runtimes].map((value) => value.dispose()));
  runtimes.clear();
});

describe('SDK artifact admission cache', () => {
  test('reuses only an admitted exact policy and recovers after eviction', async () => {
    const cache = fakeCache();
    const admissions = createArtifactAdmissionCache(cache, runtime());
    const first = await admissions.acquire({ admissionKey: 'preview-policy', artifactHash: HASH_A });
    expect(first.cached).toBe(false);
    cache.values.set(HASH_A, Uint8Array.of(1));
    first.succeed();

    expect((await admissions.acquire({ admissionKey: 'preview-policy', artifactHash: HASH_A })).cached).toBe(true);
    const releasePolicy = await admissions.acquire({ admissionKey: 'release-policy', artifactHash: HASH_A });
    expect(releasePolicy.cached).toBe(false);
    releasePolicy.fail(new Error('separate policy probe complete'));

    cache.values.delete(HASH_A);
    const afterEviction = await admissions.acquire({ admissionKey: 'preview-policy', artifactHash: HASH_A });
    expect(afterEviction.cached).toBe(false);
    afterEviction.fail(new Error('evicted retry failed'));
    const retry = await admissions.acquire({ admissionKey: 'preview-policy', artifactHash: HASH_A });
    expect(retry.cached).toBe(false);
    retry.fail(new Error('done'));
  });

  test('does not cross-hit a shared content hash when exact envelope bytes change', async () => {
    const cache = fakeCache();
    const admissions = createArtifactAdmissionCache(cache, runtime());
    const previewBytes = Uint8Array.of(1, 2, 3);
    const releaseBytes = Uint8Array.of(4, 5, 6);
    const first = await admissions.acquire({
      admissionKey: 'preview-policy',
      artifactHash: HASH_A,
      artifactBytes: previewBytes,
    });
    cache.values.set(HASH_A, previewBytes);
    first.succeed();

    // Another trust policy may overwrite Capsule's hash-keyed byte cache with
    // a differently signed envelope whose executable content hash is equal.
    cache.values.set(HASH_A, releaseBytes);
    const previewAgain = await admissions.acquire({
      admissionKey: 'preview-policy',
      artifactHash: HASH_A,
      artifactBytes: previewBytes,
    });
    expect(previewAgain.cached).toBe(false);
    previewAgain.fail(new Error('exact-byte retry required'));
  });

  test('never reuses one admission key for different artifact bytes', async () => {
    const cache = fakeCache();
    const admissions = createArtifactAdmissionCache(cache, runtime());
    const first = await admissions.acquire({ admissionKey: 'exact', artifactHash: HASH_A });
    cache.values.set(HASH_A, Uint8Array.of(1));
    cache.values.set(HASH_B, Uint8Array.of(2));
    first.succeed();
    const differentArtifact = await admissions.acquire({ admissionKey: 'exact', artifactHash: HASH_B });
    expect(differentArtifact.cached).toBe(false);
    differentArtifact.fail(new Error('different artifact probe complete'));
  });

  test('deduplicates misses with waiter-local cancellation', async () => {
    const cache = fakeCache();
    const admissions = createArtifactAdmissionCache(cache, runtime());
    const leader = await admissions.acquire({ admissionKey: 'exact', artifactHash: HASH_A });
    const cancelled = new AbortController();
    const cancelledWaiter = admissions.acquire({
      admissionKey: 'exact',
      artifactHash: HASH_A,
      signal: cancelled.signal,
    });
    const liveWaiter = admissions.acquire({ admissionKey: 'exact', artifactHash: HASH_A });
    cancelled.abort('cancelled-waiter');
    await expect(cancelledWaiter).rejects.toBe('cancelled-waiter');

    cache.values.set(HASH_A, Uint8Array.of(2));
    leader.succeed();
    expect((await liveWaiter).cached).toBe(true);
    expect(admissions.diagnostics()).toEqual({ admittedPolicies: 1, pendingAdmissions: 0, maxEntries: 16 });
  });

  test('failed or cancelled leaders release admission and let healthy waiters take over', async () => {
    const cache = fakeCache();
    const admissions = createArtifactAdmissionCache(cache, runtime());
    const leader = await admissions.acquire({ admissionKey: 'exact', artifactHash: HASH_A });
    const waiter = admissions.acquire({ admissionKey: 'exact', artifactHash: HASH_A });
    leader.fail(new DOMException('leader cancelled', 'AbortError'));
    leader.succeed(); // Lease settlement is idempotent and cannot leak/re-admit.

    const takeover = await waiter;
    expect(takeover.cached).toBe(false);
    cache.values.set(HASH_A, Uint8Array.of(4));
    takeover.succeed();
    expect((await admissions.acquire({ admissionKey: 'exact', artifactHash: HASH_A })).cached).toBe(true);
  });

  test('bounds both admitted and pending metadata and falls back to isolated byte mounts', async () => {
    const cache = fakeCache();
    const admissions = createArtifactAdmissionCache(cache, runtime(), 2);
    const one = await admissions.acquire({ admissionKey: 'one', artifactHash: HASH_A });
    const two = await admissions.acquire({ admissionKey: 'two', artifactHash: HASH_A });
    const fallback = await admissions.acquire({ admissionKey: 'three', artifactHash: HASH_A });

    expect(fallback.cached).toBe(false);
    fallback.succeed();
    expect(admissions.diagnostics()).toEqual({ admittedPolicies: 0, pendingAdmissions: 2, maxEntries: 2 });
    one.fail(new Error('done'));
    two.fail(new Error('done'));
    expect(admissions.diagnostics()).toEqual({ admittedPolicies: 0, pendingAdmissions: 0, maxEntries: 2 });
  });

  test('evicts admitted policy metadata before exceeding its total bound', async () => {
    const cache = fakeCache();
    const admissions = createArtifactAdmissionCache(cache, runtime(), 2);
    for (const [index, key] of ['one', 'two', 'three'].entries()) {
      const lease = await admissions.acquire({ admissionKey: key, artifactHash: HASH_A });
      cache.values.set(HASH_A, Uint8Array.of(index));
      lease.succeed();
    }
    expect(admissions.diagnostics()).toEqual({ admittedPolicies: 2, pendingAdmissions: 0, maxEntries: 2 });
    const evictedPolicy = await admissions.acquire({ admissionKey: 'one', artifactHash: HASH_A });
    expect(evictedPolicy.cached).toBe(false);
    evictedPolicy.fail(new Error('bounded probe complete'));
  });

  test('host disposal releases waiters and clears cache authority exactly once', async () => {
    const cache = fakeCache();
    const admissions = createArtifactAdmissionCache(cache, runtime());
    const leader = await admissions.acquire({ admissionKey: 'exact', artifactHash: HASH_A });
    const waiter = admissions.acquire({ admissionKey: 'exact', artifactHash: HASH_A });
    cache.values.set(HASH_A, Uint8Array.of(3));

    admissions.clear();
    admissions.clear();
    leader.succeed();
    await expect(waiter).rejects.toThrow('disposed');
    expect(cache.clears()).toBe(1);
    expect(cache.values.size).toBe(0);
    expect(admissions.diagnostics()).toEqual({ admittedPolicies: 0, pendingAdmissions: 0, maxEntries: 16 });
    await expect(admissions.acquire({ admissionKey: 'exact', artifactHash: HASH_A }))
      .rejects.toThrow('disposed');
  });

  test('canonical admission identity includes exact trusted key bytes and fingerprint', () => {
    const base = {
      artifact: { artifactHash: HASH_A, bytesDigestSha256: '1'.repeat(64) },
      signaturePolicy: {
        trustedKeyId: 'preview',
        trustedKeyBytesHex: '01ff',
        trustedKeyFingerprintSha256: HASH_A,
        requiredKeyIds: ['preview'],
        minimumValidSignatures: 1,
        rejectUntrustedSignatures: true,
      },
    };
    const reordered = {
      signaturePolicy: { ...base.signaturePolicy },
      artifact: { ...base.artifact },
    };
    expect(fnArtifactAdmissionKey(reordered)).toBe(fnArtifactAdmissionKey(base));
    expect(fnArtifactAdmissionKey({
      ...base,
      signaturePolicy: { ...base.signaturePolicy, trustedKeyBytesHex: '01fe' },
    })).not.toBe(fnArtifactAdmissionKey(base));
    expect(fnArtifactAdmissionKey({
      ...base,
      signaturePolicy: { ...base.signaturePolicy, trustedKeyFingerprintSha256: HASH_B },
    })).not.toBe(fnArtifactAdmissionKey(base));
  });
});
