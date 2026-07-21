import { fnScopedKey } from '@vibecanvas/tenant-core';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { spawn, type IDisposable, type IPty } from 'bun-pty';
import { isAbsolute, posix, win32 } from 'path';
import type { IPtyService } from './IPtyService';
import type {
  TPty,
  TPtyAttachArgs,
  TPtyAttachment,
  TPtyCreateArgs,
  TPtyPathArgs,
  TPtyScopeArgs,
  TPtyServiceBunPtyOptions,
  TPtyUpdateArgs,
} from './types';

type TPtyChunk = {
  start: number;
  end: number;
  data: Uint8Array;
};

type TPtyClient = {
  id: string;
  send: (data: Uint8Array) => void;
  close?: (code?: number, reason?: string) => void;
};

type TPtyOwner = {
  orgId: string;
  accountId: string;
  cellId: string;
  placementEpoch: number;
  filesystemId: string;
};

type TPtySession = {
  owner: TPtyOwner;
  hostWorkingDirectory: string;
  pty: TPty;
  terminal: IPty;
  onDataSubscription: IDisposable;
  onExitSubscription: IDisposable;
  exited: Promise<void>;
  chunks: TPtyChunk[];
  cursor: number;
  clients: Map<string, TPtyClient>;
};

const DEFAULT_ROWS = 24;
const DEFAULT_COLS = 80;
const MAX_REPLAY_BUFFER_BYTES = 1024 * 1024 * 4;

function normalizeSize(size?: { rows: number; cols: number }) {
  return {
    rows: Math.max(1, Math.floor(size?.rows ?? DEFAULT_ROWS)),
    cols: Math.max(1, Math.floor(size?.cols ?? DEFAULT_COLS)),
  };
}

function toUint8Array(data: Uint8Array<ArrayBuffer> | string): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}

function getDefaultShellCommand(): string {
  return process.env.SHELL || '/bin/bash';
}

function toWritableBytes(payload: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
}

function toWritableText(payload: string | ArrayBuffer | ArrayBufferView): string {
  if (typeof payload === 'string') return payload;
  return new TextDecoder().decode(toWritableBytes(payload));
}

function toSpawnEnv(overrides?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string') continue;
    env[key] = value;
  }

  if (!overrides) return env;

  for (const [key, value] of Object.entries(overrides)) {
    env[key] = value;
  }

  return env;
}

function isInvalidVirtualPath(path: string): boolean {
  return isAbsolute(path) || win32.isAbsolute(path) || path.includes('\\');
}

function normalizeVirtualPath(path: string): string {
  const normalized = posix.normalize(path || '.');
  return normalized === '.' ? '' : normalized;
}

export class PtyServiceBunPty implements IPtyService {
  readonly name = 'pty' as const;

  readonly #sessions = new Map<string, TPtySession>();
  #stopPromise: Promise<void> | null = null;
  #stopped = false;

  constructor(private readonly options: TPtyServiceBunPtyOptions) {
  }

  list(tenant: TTenantContext, args: TPtyScopeArgs): TPty[] {
    const workingDirectory = this.#resolveWorkingDirectory(tenant, args);
    if (!workingDirectory) return [];

    return [...this.#sessions.values()]
      .filter((session) => this.#isOwnedBy(session, tenant, args.filesystemId))
      .filter((session) => session.hostWorkingDirectory === workingDirectory)
      .map((session) => ({ ...session.pty }));
  }

  get(tenant: TTenantContext, args: TPtyPathArgs): TPty | null {
    const workingDirectory = this.#resolveWorkingDirectory(tenant, args);
    if (!workingDirectory) return null;

    const session = this.#sessions.get(this.#sessionKey(tenant, args.filesystemId, args.ptyID));
    if (!session || session.hostWorkingDirectory !== workingDirectory) return null;
    return { ...session.pty };
  }

  async create(tenant: TTenantContext, args: TPtyCreateArgs): Promise<TPty> {
    if (this.#stopped) {
      throw new Error('PTY service has been stopped');
    }

    const requestedDirectory = args.body?.cwd?.trim() || args.workingDirectory;
    if (isInvalidVirtualPath(requestedDirectory)) {
      throw new Error('PTY working directory not found');
    }
    const virtualWorkingDirectory = normalizeVirtualPath(requestedDirectory);
    const workingDirectory = this.options.resolveWorkingDirectory(tenant, {
      filesystemId: args.filesystemId,
      path: virtualWorkingDirectory,
    });
    if (!workingDirectory) throw new Error('PTY working directory not found');

    const command = args.body?.command?.trim() || getDefaultShellCommand();
    const commandArgs = args.body?.args ? [...args.body.args] : [];
    const title = args.body?.title?.trim() || 'Terminal';
    const size = normalizeSize(args.body?.size);
    const id = this.options.createSessionId?.() ?? crypto.randomUUID();
    const sessionKey = this.#sessionKey(tenant, args.filesystemId, id);
    if (this.#sessions.has(sessionKey)) throw new Error('PTY session already exists');

    const createdAt = this.#now();
    const env = toSpawnEnv(args.body?.env);
    const terminal = spawn(command, commandArgs, {
      name: env.TERM || 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd: workingDirectory,
      env,
    });

    let resolveExited!: () => void;
    const exited = new Promise<void>((resolve) => {
      resolveExited = resolve;
    });

    const onDataSubscription = terminal.onData((data) => {
      const session = this.#sessions.get(sessionKey);
      if (!session) return;
      this.#appendOutput(session, toUint8Array(data));
    });

    const onExitSubscription = terminal.onExit((event) => {
      const session = this.#sessions.get(sessionKey);
      resolveExited();
      if (!session) return;

      session.pty.status = 'exited';
      session.pty.exitCode = typeof event.exitCode === 'number' ? event.exitCode : null;
      session.pty.signalCode = typeof event.signal === 'string'
        ? event.signal
        : typeof event.signal === 'number'
          ? `${event.signal}`
          : null;
      session.pty.updatedAt = this.#now();
      this.#closeClients(session, 1000, 'PTY exited');
    });

    const pty: TPty = {
      id,
      title,
      command,
      args: commandArgs,
      cwd: virtualWorkingDirectory,
      status: 'running',
      pid: terminal.pid,
      rows: size.rows,
      cols: size.cols,
      exitCode: null,
      signalCode: null,
      createdAt,
      updatedAt: createdAt,
    };

    const session: TPtySession = {
      owner: {
        orgId: tenant.orgId,
        accountId: tenant.accountId,
        cellId: tenant.cellId,
        placementEpoch: tenant.placementEpoch,
        filesystemId: args.filesystemId,
      },
      hostWorkingDirectory: workingDirectory,
      pty,
      terminal,
      onDataSubscription,
      onExitSubscription,
      exited,
      chunks: [],
      cursor: 0,
      clients: new Map(),
    };

    this.#sessions.set(sessionKey, session);
    return { ...pty };
  }

  update(tenant: TTenantContext, args: TPtyUpdateArgs): TPty | null {
    const workingDirectory = this.#resolveWorkingDirectory(tenant, args);
    if (!workingDirectory) return null;

    const session = this.#sessions.get(this.#sessionKey(tenant, args.filesystemId, args.ptyID));
    if (!session || session.hostWorkingDirectory !== workingDirectory) return null;

    if (typeof args.body.title === 'string') {
      session.pty.title = args.body.title;
    }

    if (args.body.size) {
      const size = normalizeSize(args.body.size);
      session.terminal.resize(size.cols, size.rows);
      session.pty.rows = size.rows;
      session.pty.cols = size.cols;
    }

    session.pty.updatedAt = this.#now();
    return { ...session.pty };
  }

  async remove(tenant: TTenantContext, args: TPtyPathArgs): Promise<boolean> {
    const workingDirectory = this.#resolveWorkingDirectory(tenant, args);
    if (!workingDirectory) return false;

    const sessionKey = this.#sessionKey(tenant, args.filesystemId, args.ptyID);
    const session = this.#sessions.get(sessionKey);
    if (!session || session.hostWorkingDirectory !== workingDirectory) return false;

    this.#sessions.delete(sessionKey);
    await this.#destroySession(session, 'Removed');
    return true;
  }

  attach(tenant: TTenantContext, args: TPtyAttachArgs): TPtyAttachment | null {
    const workingDirectory = this.#resolveWorkingDirectory(tenant, args);
    if (!workingDirectory) return null;

    const sessionKey = this.#sessionKey(tenant, args.filesystemId, args.ptyID);
    const session = this.#sessions.get(sessionKey);
    if (!session || session.hostWorkingDirectory !== workingDirectory) return null;

    const clientId = this.options.createClientId?.() ?? crypto.randomUUID();
    const client: TPtyClient = {
      id: clientId,
      send: args.send,
      close: args.close,
    };

    session.clients.set(clientId, client);
    this.#replay(session, client, args.cursor ?? 0);

    if (session.pty.status !== 'running') {
      queueMicrotask(() => client.close?.(1000, 'PTY exited'));
    }

    let attached = true;
    return {
      send: (payload: string | ArrayBuffer | ArrayBufferView) => {
        if (!attached) return;
        const activeSession = this.#sessions.get(sessionKey);
        if (!activeSession || activeSession.pty.status !== 'running') return;
        activeSession.terminal.write(toWritableText(payload));
      },
      detach: () => {
        if (!attached) return;
        attached = false;
        const activeSession = this.#sessions.get(sessionKey);
        if (!activeSession) return;
        activeSession.clients.delete(clientId);
      },
    };
  }

  stop(): Promise<void> {
    return this.shutdown('Service stop');
  }

  async shutdown(reason = 'Service stop'): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;

    this.#stopped = true;
    this.#stopPromise = (async () => {
      const sessions = [...this.#sessions.values()];
      this.#sessions.clear();
      await Promise.allSettled(sessions.map((session) => this.#destroySession(session, reason)));
    })();

    return this.#stopPromise;
  }

  #sessionKey(tenant: TTenantContext, filesystemId: string, ptyID: string): string {
    return fnScopedKey('pty-session', [
      tenant.orgId,
      tenant.accountId,
      tenant.cellId,
      `${tenant.placementEpoch}`,
      filesystemId,
      ptyID,
    ]);
  }

  #resolveWorkingDirectory(tenant: TTenantContext, args: TPtyScopeArgs): string | null {
    if (isInvalidVirtualPath(args.workingDirectory)) return null;
    return this.options.resolveWorkingDirectory(tenant, {
      filesystemId: args.filesystemId,
      path: normalizeVirtualPath(args.workingDirectory),
    });
  }

  #isOwnedBy(session: TPtySession, tenant: TTenantContext, filesystemId: string): boolean {
    return session.owner.orgId === tenant.orgId
      && session.owner.accountId === tenant.accountId
      && session.owner.cellId === tenant.cellId
      && session.owner.placementEpoch === tenant.placementEpoch
      && session.owner.filesystemId === filesystemId;
  }

  #now(): number {
    return this.options.now?.() ?? Date.now();
  }

  #appendOutput(session: TPtySession, data: Uint8Array): void {
    if (data.byteLength === 0) return;

    const start = session.cursor;
    session.cursor += data.byteLength;
    session.pty.updatedAt = this.#now();
    session.chunks.push({
      start,
      end: session.cursor,
      data,
    });

    let totalBytes = 0;
    for (let index = session.chunks.length - 1; index >= 0; index -= 1) {
      totalBytes += session.chunks[index]!.data.byteLength;
      if (totalBytes > MAX_REPLAY_BUFFER_BYTES) {
        session.chunks.splice(0, index + 1);
        break;
      }
    }

    for (const client of session.clients.values()) {
      client.send(data);
    }
  }

  #replay(session: TPtySession, client: TPtyClient, requestedCursor: number): void {
    const cursor = Math.max(0, Math.floor(requestedCursor));

    for (const chunk of session.chunks) {
      if (chunk.end <= cursor) continue;
      if (cursor <= chunk.start) {
        client.send(chunk.data);
        continue;
      }

      const offset = cursor - chunk.start;
      client.send(chunk.data.subarray(offset));
    }
  }

  #closeClients(session: TPtySession, code: number, reason: string): void {
    for (const client of session.clients.values()) {
      client.close?.(code, reason);
    }
    session.clients.clear();
  }

  async #destroySession(session: TPtySession, reason: string): Promise<void> {
    this.#closeClients(session, 1000, reason);

    try {
      session.terminal.kill('SIGTERM');
    } catch {
      // ignore
    }

    await Promise.race([
      session.exited.catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 150)),
    ]);

    try {
      if (session.pty.status === 'running') {
        session.terminal.kill('SIGKILL');
      }
    } catch {
      // ignore
    }

    try {
      session.onDataSubscription.dispose();
      session.onExitSubscription.dispose();
    } catch {
      // ignore
    }
  }
}
