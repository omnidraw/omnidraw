/** @file Process-owned orchestration for ephemeral filesystem widget Preview. */

import {
  PREVIEW_DEFAULT_MAX_CACHED_CONSTRUCTIONS,
  PREVIEW_DEFAULT_MAX_DIAGNOSTICS,
  PREVIEW_DEFAULT_MAX_DIAGNOSTIC_CHARACTERS,
  PREVIEW_DEFAULT_MAX_MOUNTED_HANDLES,
  PREVIEW_DEFAULT_MAX_SESSIONS,
} from './CONSTANTS';
import {
  fnCanReusePreviewConstruction,
  fnNormalizePreviewDiagnostic,
  fnNormalizePreviewExecutableInputDigest,
  fnNormalizePreviewConstructionCompatibility,
  fnNormalizePreviewSessionId,
  fnNormalizePreviewWidgetKey,
  fnPreviewConstructionCompatibilityKey,
  fnPreviewTempRelativePath,
} from './fn.policy';
import type {
  TPreviewConstructionCompatibility,
  TPreviewDiagnostic,
  TPreviewOpenArgs,
  TPreviewOpenResult,
  TPreviewPorts,
  TPreviewServiceConfig,
  TPreviewSessionPhase,
  TPreviewSessionView,
  TReusablePreviewConstruction,
} from './typed';

type TConstructionCacheEntry<TConstruction> = {
  ownerSessionId: string;
  widgetKey: string;
  executableInputDigestSha256: string;
  compatibility: TPreviewConstructionCompatibility;
  construction: TConstruction;
};

type TPreviewSession<TConstruction, TSignedArtifact, TMountHandle> = {
  sessionId: string;
  widgetKey: string;
  executableInputDigestSha256: string;
  compatibility: TPreviewConstructionCompatibility;
  tempRelativePath: string;
  phase: TPreviewSessionPhase;
  constructionReused: boolean;
  diagnostics: TPreviewDiagnostic[];
  droppedDiagnosticCount: number;
  failureMessage: string | null;
  controller: AbortController;
  externalSignal: AbortSignal | null;
  externalAbortListener: (() => void) | null;
  construction: TConstruction | null;
  signedArtifact: TSignedArtifact | null;
  handles: TMountHandle[];
  tempPrepared: boolean;
  cleaned: boolean;
  run: Promise<TPreviewOpenResult<TSignedArtifact, TMountHandle>> | null;
};

function boundedInteger(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${label} must be an integer from 1 to ${maximum}.`);
  }
  return value;
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 4_096) : 'Preview operation failed.';
}

export class PreviewCancelledError extends Error {
  readonly code = 'WIDGET_PREVIEW_CANCELLED';

  constructor() {
    super('Preview was cancelled.');
    this.name = 'PreviewCancelledError';
  }
}

/**
 * Owns Preview only for this object/process lifetime.
 *
 * The port intentionally has no database, scan, load, or recovery operation.
 * A new service starts empty even when an old `.preview` path remains after a
 * hard process failure.
 */
export class EphemeralPreviewService<TConstruction, TSignedArtifact, TMountHandle> {
  readonly #ports: TPreviewPorts<TConstruction, TSignedArtifact, TMountHandle>;
  readonly #maxSessions: number;
  readonly #maxCachedConstructions: number;
  readonly #maxMountedHandles: number;
  readonly #maxDiagnosticsPerSession: number;
  readonly #maxDiagnosticCharacters: number;
  readonly #sessions = new Map<
    string,
    TPreviewSession<TConstruction, TSignedArtifact, TMountHandle>
  >();
  readonly #constructionCache = new Map<string, TConstructionCacheEntry<TConstruction>>();
  #mountedHandleCount = 0;
  #reservedHandleCount = 0;
  #closed = false;

  constructor(
    ports: TPreviewPorts<TConstruction, TSignedArtifact, TMountHandle>,
    config: TPreviewServiceConfig = {},
  ) {
    this.#ports = ports;
    this.#maxSessions = boundedInteger(
      config.maxSessions ?? PREVIEW_DEFAULT_MAX_SESSIONS,
      'Preview session limit',
      1_024,
    );
    this.#maxCachedConstructions = boundedInteger(
      config.maxCachedConstructions ?? PREVIEW_DEFAULT_MAX_CACHED_CONSTRUCTIONS,
      'Preview construction cache limit',
      1_024,
    );
    this.#maxMountedHandles = boundedInteger(
      config.maxMountedHandles ?? PREVIEW_DEFAULT_MAX_MOUNTED_HANDLES,
      'Preview mounted-handle limit',
      1_024,
    );
    this.#maxDiagnosticsPerSession = boundedInteger(
      config.maxDiagnosticsPerSession ?? PREVIEW_DEFAULT_MAX_DIAGNOSTICS,
      'Preview diagnostic limit',
      10_000,
    );
    this.#maxDiagnosticCharacters = boundedInteger(
      config.maxDiagnosticCharacters ?? PREVIEW_DEFAULT_MAX_DIAGNOSTIC_CHARACTERS,
      'Preview diagnostic character limit',
      65_536,
    );
  }

  open(
    args: TPreviewOpenArgs,
  ): Promise<TPreviewOpenResult<TSignedArtifact, TMountHandle>> {
    if (this.#closed) return Promise.reject(new Error('Preview service is closed.'));
    if (this.#sessions.size >= this.#maxSessions) {
      return Promise.reject(new Error('Preview session limit reached.'));
    }
    const sessionId = fnNormalizePreviewSessionId(args.sessionId);
    if (this.#sessions.has(sessionId)) {
      return Promise.reject(new Error(`Preview session already exists: ${sessionId}`));
    }
    const widgetKey = fnNormalizePreviewWidgetKey(args.widgetKey);
    const executableInputDigestSha256 = fnNormalizePreviewExecutableInputDigest(
      args.executableInputDigestSha256,
    );
    const compatibility = fnNormalizePreviewConstructionCompatibility(args.compatibility);
    const controller = new AbortController();
    const session: TPreviewSession<TConstruction, TSignedArtifact, TMountHandle> = {
      sessionId,
      widgetKey,
      executableInputDigestSha256,
      compatibility,
      tempRelativePath: fnPreviewTempRelativePath(sessionId),
      phase: 'building',
      constructionReused: false,
      diagnostics: [],
      droppedDiagnosticCount: 0,
      failureMessage: null,
      controller,
      externalSignal: args.signal ?? null,
      externalAbortListener: null,
      construction: null,
      signedArtifact: null,
      handles: [],
      tempPrepared: false,
      cleaned: false,
      run: null,
    };
    if (args.signal !== undefined) {
      const abort = () => controller.abort();
      session.externalAbortListener = abort;
      args.signal.addEventListener('abort', abort, { once: true });
      if (args.signal.aborted) controller.abort();
    }
    this.#sessions.set(sessionId, session);
    const run = this.#run(session);
    session.run = run;
    return run;
  }

  get(sessionId: string): TPreviewSessionView | null {
    return this.#sessions.get(sessionId) === undefined
      ? null
      : this.#view(this.#sessions.get(sessionId)!);
  }

  reusableConstruction(args: Readonly<{
    executableInputDigestSha256: string;
    compatibility: TPreviewConstructionCompatibility;
  }>): TReusablePreviewConstruction<TConstruction> | null {
    const digest = fnNormalizePreviewExecutableInputDigest(args.executableInputDigestSha256);
    const key = this.#constructionKey(digest, args.compatibility);
    const entry = this.#constructionCache.get(key);
    if (
      entry === undefined
      || !fnCanReusePreviewConstruction({
        candidateExecutableInputDigestSha256: entry.executableInputDigestSha256,
        candidateCompatibility: entry.compatibility,
        requestedExecutableInputDigestSha256: digest,
        requestedCompatibility: args.compatibility,
      })
    ) return null;
    return Object.freeze({
      ownerSessionId: entry.ownerSessionId,
      executableInputDigestSha256: entry.executableInputDigestSha256,
      compatibility: entry.compatibility,
      validated: true as const,
      construction: entry.construction,
    });
  }

  async cancel(sessionId: string): Promise<boolean> {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) return false;
    session.controller.abort();
    await session.run?.catch(() => undefined);
    await this.#cleanup(session);
    session.phase = 'cancelled';
    session.failureMessage = 'Preview was cancelled.';
    return true;
  }

  async close(sessionId: string): Promise<boolean> {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) return false;
    await this.cancel(sessionId);
    this.#sessions.delete(sessionId);
    return true;
  }

  async closeWidget(widgetKeyInput: string): Promise<number> {
    const widgetKey = fnNormalizePreviewWidgetKey(widgetKeyInput);
    const sessions = [...this.#sessions.values()]
      .filter((session) => session.widgetKey === widgetKey)
      .map((session) => session.sessionId);
    await Promise.all(sessions.map((sessionId) => this.close(sessionId)));
    for (const [key, entry] of this.#constructionCache) {
      if (entry.widgetKey === widgetKey) this.#constructionCache.delete(key);
    }
    return sessions.length;
  }

  async shutdown(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.all([...this.#sessions.keys()].map((sessionId) => this.close(sessionId)));
    this.#constructionCache.clear();
  }

  async #run(
    session: TPreviewSession<TConstruction, TSignedArtifact, TMountHandle>,
  ): Promise<TPreviewOpenResult<TSignedArtifact, TMountHandle>> {
    try {
      this.#assertActive(session);
      await this.#ports.prepareTempPath({
        relativePath: session.tempRelativePath,
        signal: session.controller.signal,
      });
      session.tempPrepared = true;
      this.#assertActive(session);

      const cacheKey = this.#constructionKey(
        session.executableInputDigestSha256,
        session.compatibility,
      );
      const cached = this.#constructionCache.get(cacheKey);
      if (
        cached !== undefined
        && fnCanReusePreviewConstruction({
          candidateExecutableInputDigestSha256: cached.executableInputDigestSha256,
          candidateCompatibility: cached.compatibility,
          requestedExecutableInputDigestSha256: session.executableInputDigestSha256,
          requestedCompatibility: session.compatibility,
        })
      ) {
        this.#constructionCache.delete(cacheKey);
        this.#constructionCache.set(cacheKey, cached);
        session.construction = cached.construction;
        session.constructionReused = true;
      } else {
        session.construction = await this.#ports.buildConstruction({
          sessionId: session.sessionId,
          widgetKey: session.widgetKey,
          executableInputDigestSha256: session.executableInputDigestSha256,
          compatibility: session.compatibility,
          tempRelativePath: session.tempRelativePath,
          signal: session.controller.signal,
          reportDiagnostic: (diagnostic) => this.#appendDiagnostic(session, diagnostic),
        });
        this.#assertActive(session);
        session.phase = 'validating';
        await this.#ports.validateConstruction({
          construction: session.construction,
          executableInputDigestSha256: session.executableInputDigestSha256,
          compatibility: session.compatibility,
          signal: session.controller.signal,
        });
        this.#assertActive(session);
        while (this.#constructionCache.size >= this.#maxCachedConstructions) {
          const oldestKey = this.#constructionCache.keys().next().value as string | undefined;
          if (oldestKey === undefined) break;
          this.#constructionCache.delete(oldestKey);
        }
        this.#constructionCache.set(cacheKey, {
          ownerSessionId: session.sessionId,
          widgetKey: session.widgetKey,
          executableInputDigestSha256: session.executableInputDigestSha256,
          compatibility: session.compatibility,
          construction: session.construction,
        });
      }

      session.phase = 'signing';
      session.signedArtifact = await this.#ports.signConstruction({
        construction: session.construction,
        executableInputDigestSha256: session.executableInputDigestSha256,
        compatibility: session.compatibility,
        signal: session.controller.signal,
      });
      this.#assertActive(session);

      if (
        this.#mountedHandleCount + this.#reservedHandleCount
        >= this.#maxMountedHandles
      ) throw new Error('Preview mounted-handle limit reached.');
      this.#reservedHandleCount += 1;
      session.phase = 'mounting';
      let handle: TMountHandle;
      try {
        handle = await this.#ports.mount({
          sessionId: session.sessionId,
          widgetKey: session.widgetKey,
          signedArtifact: session.signedArtifact,
          tempRelativePath: session.tempRelativePath,
          signal: session.controller.signal,
        });
      } finally {
        this.#reservedHandleCount -= 1;
      }
      if (session.controller.signal.aborted) {
        await this.#ports.unmount({ sessionId: session.sessionId, handle });
        throw new PreviewCancelledError();
      }
      this.#assertActive(session);
      session.handles.push(handle);
      this.#mountedHandleCount += 1;
      session.phase = 'ready';
      return Object.freeze({
        session: this.#view(session),
        signedArtifact: session.signedArtifact,
        mountHandle: handle,
      });
    } catch (error) {
      session.phase = session.controller.signal.aborted ? 'cancelled' : 'failed';
      session.failureMessage = session.controller.signal.aborted
        ? 'Preview was cancelled.'
        : failureMessage(error);
      this.#appendDiagnostic(session, {
        severity: 'error',
        code: session.controller.signal.aborted ? 'PREVIEW_CANCELLED' : 'PREVIEW_FAILED',
        message: session.failureMessage,
      });
      await this.#cleanup(session);
      if (session.controller.signal.aborted && !(error instanceof PreviewCancelledError)) {
        throw new PreviewCancelledError();
      }
      throw error;
    } finally {
      if (session.externalSignal !== null && session.externalAbortListener !== null) {
        session.externalSignal.removeEventListener('abort', session.externalAbortListener);
        session.externalAbortListener = null;
      }
    }
  }

  #assertActive(
    session: TPreviewSession<TConstruction, TSignedArtifact, TMountHandle>,
  ): void {
    if (this.#sessions.get(session.sessionId) !== session || session.controller.signal.aborted) {
      throw new PreviewCancelledError();
    }
  }

  #constructionKey(
    executableInputDigestSha256: string,
    compatibility: TPreviewConstructionCompatibility,
  ): string {
    return `${executableInputDigestSha256}\u0000${fnPreviewConstructionCompatibilityKey(compatibility)}`;
  }

  #appendDiagnostic(
    session: TPreviewSession<TConstruction, TSignedArtifact, TMountHandle>,
    diagnostic: Parameters<typeof fnNormalizePreviewDiagnostic>[0]['diagnostic'],
  ): void {
    if (session.diagnostics.length >= this.#maxDiagnosticsPerSession) {
      session.droppedDiagnosticCount += 1;
      return;
    }
    session.diagnostics.push(fnNormalizePreviewDiagnostic({
      diagnostic,
      maximumCharacters: this.#maxDiagnosticCharacters,
    }));
  }

  async #cleanup(
    session: TPreviewSession<TConstruction, TSignedArtifact, TMountHandle>,
  ): Promise<void> {
    if (session.cleaned) return;
    session.cleaned = true;
    for (const handle of session.handles.splice(0).reverse()) {
      try {
        await this.#ports.unmount({ sessionId: session.sessionId, handle });
      } catch (error) {
        this.#appendDiagnostic(session, {
          severity: 'error',
          code: 'PREVIEW_UNMOUNT_FAILED',
          message: failureMessage(error),
        });
      } finally {
        this.#mountedHandleCount -= 1;
      }
    }
    if (session.tempPrepared) {
      session.tempPrepared = false;
      try {
        await this.#ports.removeTempPath({ relativePath: session.tempRelativePath });
      } catch (error) {
        this.#appendDiagnostic(session, {
          severity: 'error',
          code: 'PREVIEW_TEMP_CLEANUP_FAILED',
          message: failureMessage(error),
        });
      }
    }
  }

  #view(
    session: TPreviewSession<TConstruction, TSignedArtifact, TMountHandle>,
  ): TPreviewSessionView {
    return Object.freeze({
      sessionId: session.sessionId,
      widgetKey: session.widgetKey,
      executableInputDigestSha256: session.executableInputDigestSha256,
      compatibility: session.compatibility,
      tempRelativePath: session.tempRelativePath,
      phase: session.phase,
      constructionReused: session.constructionReused,
      diagnostics: Object.freeze([...session.diagnostics]),
      droppedDiagnosticCount: session.droppedDiagnosticCount,
      mountedHandleCount: session.handles.length,
      failureMessage: session.failureMessage,
    });
  }
}

export type * from './typed';
export {
  fnCanReusePreviewConstruction,
  fnNormalizePreviewConstructionCompatibility,
  fnNormalizePreviewDiagnostic,
  fnNormalizePreviewExecutableInputDigest,
  fnNormalizePreviewSessionId,
  fnNormalizePreviewWidgetKey,
  fnPreviewConstructionCompatibilityKey,
  fnPreviewTempRelativePath,
} from './fn.policy';
