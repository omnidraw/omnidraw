import type { SdkEffectRuntime } from './effect-runtime';

type TArtifactCache = Readonly<{
  get(hash: `sha256:${string}`): Promise<Readonly<Uint8Array> | undefined>;
  clear(): void;
}>;

export type TArtifactAdmissionLease = Readonly<{
  /** True only when an exact-policy admission and the shared bytes both exist. */
  cached: boolean;
  fail(error: unknown): void;
  succeed(): void;
}>;

type TPendingAdmission = Readonly<{
  artifactHash: `sha256:${string}`;
  gate: Promise<void>;
  reject(error: unknown): void;
}>;

const DISPOSED_MESSAGE = 'The artifact admission cache is disposed.';

/** Canonicalizes an SDK-owned admission policy without retaining its inputs. */
export function fnArtifactAdmissionKey(value: unknown): string {
  const canonical = (input: unknown): string => {
    if (input === null || typeof input !== 'object') return JSON.stringify(input) ?? 'undefined';
    if (Array.isArray(input)) return `[${input.map(canonical).join(',')}]`;
    const record = input as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${canonical(record[key])}`
    )).join(',')}}`;
  };
  return canonical(value);
}

/**
 * Coordinates immutable cache admission without sharing a Capsule host or
 * guest mount. Only a leader supplies bytes. Exact-policy waiters may use a
 * hash after the leader succeeds; waiter cancellation never affects it.
 */
export function createArtifactAdmissionCache(
  cache: TArtifactCache,
  runtime: SdkEffectRuntime,
  maxAdmissionEntries = 16,
) {
  if (!Number.isSafeInteger(maxAdmissionEntries) || maxAdmissionEntries < 1) {
    throw new RangeError('Artifact admission metadata requires a positive bounded entry count.');
  }

  const admittedPolicies = new Map<string, `sha256:${string}`>();
  const pendingAdmissions = new Map<string, TPendingAdmission>();
  let disposed = false;

  const disposedError = (): Error => new Error(DISPOSED_MESSAGE);

  const awaitPending = async (pending: Promise<void>, signal?: AbortSignal): Promise<void> => {
    await runtime.run(async (runtimeSignal) => new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onRequestAbort);
        runtimeSignal.removeEventListener('abort', onRuntimeAbort);
        action();
      };
      const abort = (source: AbortSignal): void => finish(() => {
        reject(source.reason ?? new Error('Widget mount was aborted.'));
      });
      const onRequestAbort = (): void => abort(signal!);
      const onRuntimeAbort = (): void => abort(runtimeSignal);
      signal?.addEventListener('abort', onRequestAbort, { once: true });
      runtimeSignal.addEventListener('abort', onRuntimeAbort, { once: true });
      pending.then(
        () => finish(resolve),
        (error) => finish(() => reject(error)),
      );
      if (signal?.aborted) onRequestAbort();
      else if (runtimeSignal.aborted) onRuntimeAbort();
    }));
  };

  const evictAdmittedUntilRoom = (): void => {
    while (admittedPolicies.size + pendingAdmissions.size >= maxAdmissionEntries) {
      const oldest = admittedPolicies.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      admittedPolicies.delete(oldest);
    }
  };

  return Object.freeze({
    diagnostics: () => Object.freeze({
      admittedPolicies: admittedPolicies.size,
      pendingAdmissions: pendingAdmissions.size,
      maxEntries: maxAdmissionEntries,
    }),

    async acquire(args: Readonly<{
      admissionKey: string;
      artifactHash: `sha256:${string}`;
      artifactBytes?: Readonly<Uint8Array>;
      signal?: AbortSignal;
    }>): Promise<TArtifactAdmissionLease> {
      if (disposed) throw disposedError();
      while (true) {
        if (args.signal?.aborted) {
          throw args.signal.reason ?? new Error('Widget mount was aborted.');
        }
        if (disposed) throw disposedError();

        const admittedHash = admittedPolicies.get(args.admissionKey);
        if (admittedHash !== undefined && admittedHash !== args.artifactHash) {
          admittedPolicies.delete(args.admissionKey);
        } else if (admittedHash !== undefined) {
          let cached: Readonly<Uint8Array> | undefined;
          try {
            cached = await cache.get(args.artifactHash);
          } catch (error) {
            admittedPolicies.delete(args.admissionKey);
            throw error;
          }
          if (disposed) throw disposedError();
          if (args.signal?.aborted) {
            throw args.signal.reason ?? new Error('Widget mount was aborted.');
          }
          const exactBytes = args.artifactBytes === undefined
            || (cached !== undefined
              && cached.byteLength === args.artifactBytes.byteLength
              && cached.every((byte, index) => byte === args.artifactBytes![index]));
          if (cached !== undefined && exactBytes) {
            admittedPolicies.delete(args.admissionKey);
            admittedPolicies.set(args.admissionKey, admittedHash);
            return Object.freeze({ cached: true, fail: () => undefined, succeed: () => undefined });
          }
          admittedPolicies.delete(args.admissionKey);
        }

        const pending = pendingAdmissions.get(args.admissionKey);
        if (pending !== undefined) {
          if (pending.artifactHash !== args.artifactHash) {
            // A policy key collision must never replace an in-flight leader or
            // let its eventual settlement admit different bytes.
            return Object.freeze({ cached: false, fail: () => undefined, succeed: () => undefined });
          }
          try {
            await awaitPending(pending.gate, args.signal);
          } catch (error) {
            if (args.signal?.aborted) throw error;
            if (disposed) throw disposedError();
            // Mount-local leader failures are not inherited by healthy waiters.
          }
          continue;
        }

        // Metadata remains bounded even when many unrelated policies arrive.
        // If every slot is an in-flight leader, mount independently with bytes.
        evictAdmittedUntilRoom();
        if (admittedPolicies.size + pendingAdmissions.size >= maxAdmissionEntries) {
          return Object.freeze({ cached: false, fail: () => undefined, succeed: () => undefined });
        }

        let settled = false;
        let resolveAdmission!: () => void;
        let rejectAdmission!: (error: unknown) => void;
        const gate = new Promise<void>((resolve, reject) => {
          resolveAdmission = resolve;
          rejectAdmission = reject;
        });
        // A leader is allowed to have no waiter.
        void gate.catch(() => undefined);
        const entry = Object.freeze({ artifactHash: args.artifactHash, gate, reject: rejectAdmission });
        pendingAdmissions.set(args.admissionKey, entry);

        const settle = (error?: unknown): void => {
          if (settled) return;
          settled = true;
          if (pendingAdmissions.get(args.admissionKey) === entry) {
            pendingAdmissions.delete(args.admissionKey);
          }
          if (error === undefined && !disposed) {
            admittedPolicies.delete(args.admissionKey);
            admittedPolicies.set(args.admissionKey, args.artifactHash);
            while (admittedPolicies.size + pendingAdmissions.size > maxAdmissionEntries) {
              const oldest = admittedPolicies.keys().next().value as string | undefined;
              if (oldest === undefined) break;
              admittedPolicies.delete(oldest);
            }
            resolveAdmission();
          } else {
            admittedPolicies.delete(args.admissionKey);
            rejectAdmission(error ?? disposedError());
          }
        };

        return Object.freeze({
          cached: false,
          fail: (error: unknown) => settle(error),
          succeed: () => settle(),
        });
      }
    },

    clear(): void {
      if (disposed) return;
      disposed = true;
      for (const pending of pendingAdmissions.values()) pending.reject(disposedError());
      pendingAdmissions.clear();
      admittedPolicies.clear();
      cache.clear();
    },
  });
}
