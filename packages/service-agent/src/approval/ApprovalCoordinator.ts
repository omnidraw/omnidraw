import { randomUUID } from 'node:crypto';
import type {
  TApprovalDecision,
  TApprovalView,
  TProtectedApprovalKind,
  TToolAuthorizationContext,
  TToolAuthorizer,
} from './types';

type TPendingApproval = {
  view: TApprovalView;
  authorization: TToolAuthorizationContext;
  status: 'pending' | 'claimed';
  timer: ReturnType<typeof setTimeout>;
  abortSignal?: AbortSignal;
  onAbort?: () => void;
  approve: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type TApprovalCoordinatorConfig = {
  createId?: () => string;
  now?: () => Date;
  timeoutMs?: number;
  authorize?: TToolAuthorizer;
  onChanged?: (event: { type: 'created' | 'resolved' | 'canceled'; approval: TApprovalView; decision?: TApprovalDecision; reason?: string }) => void;
};

type TRequestApprovalArgs<TArgs, TResult> = {
  chatId: string;
  kind: TProtectedApprovalKind;
  authorization: TToolAuthorizationContext;
  exactArgs: TArgs;
  summary: string;
  risk: TApprovalView['risk'];
  warnings?: string[];
  safeDetails: unknown;
  signal?: AbortSignal;
  execute: (args: Readonly<TArgs>) => Promise<TResult>;
};

export class ApprovalRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalRejectedError';
  }
}

export class ApprovalCoordinator {
  readonly #createId: () => string;
  readonly #now: () => Date;
  readonly #timeoutMs: number;
  readonly #authorize?: TToolAuthorizer;
  readonly #onChanged?: TApprovalCoordinatorConfig['onChanged'];
  readonly #pending = new Map<string, TPendingApproval>();

  constructor(config: TApprovalCoordinatorConfig = {}) {
    this.#createId = config.createId ?? randomUUID;
    this.#now = config.now ?? (() => new Date());
    this.#timeoutMs = config.timeoutMs ?? 120_000;
    this.#authorize = config.authorize;
    this.#onChanged = config.onChanged;
  }

  list(chatId: string): TApprovalView[] {
    return Array.from(this.#pending.values())
      .filter((pending) => pending.view.chatId === chatId && pending.status === 'pending')
      .map((pending) => structuredClone(pending.view))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  get(chatId: string, approvalId: string): TApprovalView | null {
    const pending = this.#pending.get(approvalId);
    return pending?.view.chatId === chatId && pending.status === 'pending' ? structuredClone(pending.view) : null;
  }

  request<TArgs, TResult>(args: TRequestApprovalArgs<TArgs, TResult>): Promise<TResult> {
    if (args.signal?.aborted) return Promise.reject(new ApprovalRejectedError('Protected operation was canceled.'));
    const id = this.#createId();
    if (this.#pending.has(id)) return Promise.reject(new Error('Approval ID collision.'));
    const createdAt = this.#now();
    const expiresAt = new Date(createdAt.getTime() + this.#timeoutMs);
    const exactArgs = this.#deepFreeze(structuredClone(args.exactArgs));
    const view: TApprovalView = this.#deepFreeze({
      id,
      chatId: args.chatId,
      kind: args.kind,
      summary: args.summary,
      risk: args.risk,
      warnings: [...(args.warnings ?? [])],
      details: structuredClone(args.safeDetails),
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#cancel(id, 'Protected operation approval timed out.');
      }, this.#timeoutMs);
      timer.unref?.();
      const pending: TPendingApproval = {
        view,
        authorization: structuredClone(args.authorization),
        status: 'pending',
        timer,
        abortSignal: args.signal,
        approve: () => args.execute(exactArgs),
        resolve: (value) => resolve(value as TResult),
        reject,
      };
      if (args.signal) {
        pending.onAbort = () => this.#cancel(id, 'Protected operation was canceled.');
        args.signal.addEventListener('abort', pending.onAbort, { once: true });
      }
      this.#pending.set(id, pending);
      this.#onChanged?.({ type: 'created', approval: structuredClone(view) });
    });
  }

  async resolve(chatId: string, approvalId: string, decision: TApprovalDecision, authorization: TToolAuthorizationContext): Promise<{ resolved: true; decision: TApprovalDecision }> {
    const pending = this.#pending.get(approvalId);
    if (!pending || pending.view.chatId !== chatId) throw new Error('Approval request was not found or is no longer pending.');
    if (pending.status !== 'pending') throw new Error('Approval request is already being resolved.');
    pending.status = 'claimed';
    this.#stopCancellation(pending);

    if (decision === 'reject') {
      this.#finalize(pending);
      pending.reject(new ApprovalRejectedError('Protected operation was rejected by the user.'));
      this.#onChanged?.({ type: 'resolved', approval: structuredClone(pending.view), decision });
      return { resolved: true, decision };
    }

    let authorized: boolean;
    try {
      authorized = await this.#isAuthorized(chatId, authorization);
    } catch (error) {
      this.#finalize(pending);
      pending.reject(new ApprovalRejectedError('Authorization could not be rechecked before approval execution.'));
      this.#onChanged?.({ type: 'canceled', approval: structuredClone(pending.view), reason: 'authorization-check-failed' });
      throw error;
    }
    if (!authorized) {
      this.#finalize(pending);
      pending.reject(new ApprovalRejectedError('Authorization changed before approval execution.'));
      this.#onChanged?.({ type: 'canceled', approval: structuredClone(pending.view), reason: 'authorization-changed' });
      throw new Error('Not authorized to approve this protected operation.');
    }

    try {
      const result = await pending.approve();
      this.#finalize(pending);
      pending.resolve(result);
      this.#onChanged?.({ type: 'resolved', approval: structuredClone(pending.view), decision });
      return { resolved: true, decision };
    } catch (error) {
      this.#finalize(pending);
      pending.reject(error instanceof Error ? error : new Error(String(error)));
      this.#onChanged?.({ type: 'canceled', approval: structuredClone(pending.view), reason: 'execution-failed' });
      throw error;
    }
  }

  cancelChat(chatId: string, reason = 'Chat disconnected before approval.'): number {
    const ids = Array.from(this.#pending.entries())
      .filter(([, pending]) => pending.view.chatId === chatId && pending.status === 'pending')
      .map(([id]) => id);
    for (const id of ids) this.#cancel(id, reason);
    return ids.length;
  }

  close(reason = 'Agent service stopped before approval.'): void {
    const ids = Array.from(this.#pending.entries())
      .filter(([, pending]) => pending.status === 'pending')
      .map(([id]) => id);
    for (const id of ids) this.#cancel(id, reason);
  }

  #cancel(id: string, reason: string): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#finalize(pending);
    pending.reject(new ApprovalRejectedError(reason));
    this.#onChanged?.({ type: 'canceled', approval: structuredClone(pending.view), reason });
  }

  #finalize(pending: TPendingApproval): void {
    this.#stopCancellation(pending);
    this.#pending.delete(pending.view.id);
  }

  #stopCancellation(pending: TPendingApproval): void {
    clearTimeout(pending.timer);
    if (pending.abortSignal && pending.onAbort) pending.abortSignal.removeEventListener('abort', pending.onAbort);
  }

  async #isAuthorized(chatId: string, context: TToolAuthorizationContext): Promise<boolean> {
    if (!this.#authorize) return true;
    return this.#authorize({ chatId, toolName: 'approval.resolve', context });
  }

  #deepFreeze<T>(value: T): T {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value as Record<string, unknown>)) this.#deepFreeze(child);
    return Object.freeze(value);
  }
}
