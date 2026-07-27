import type {
  IService,
  IStartableService,
  IStoppableService,
} from "@vibecanvas/runtime";
import { SyncHook } from "@vibecanvas/tapable";
import type {
  CrdtService,
  TCrdtChangeSummary,
} from "../crdt/CrdtService";
import { fnClassifyActiveSessionChange } from "./fn.classify-change";
import type {
  TCanvasActiveSession,
  TCanvasActiveSessionCancelReason,
  TCanvasActiveSessionDecision,
} from "./typed";

export type TCanvasActiveSessionServiceHooks = {
  change: SyncHook<[TCanvasActiveSession | null]>;
  decision: SyncHook<[TCanvasActiveSessionDecision]>;
};

type TActiveRecord = {
  session: TCanvasActiveSession;
  cancelled: boolean;
};

export type TCanvasActiveSessionServiceArgs = {
  crdt?: Pick<CrdtService, "hooks">;
};

export class CanvasActiveSessionService
implements
  IService<TCanvasActiveSessionServiceHooks>,
  IStartableService,
  IStoppableService {
  readonly name = "activeSession";
  readonly hooks: TCanvasActiveSessionServiceHooks = {
    change: new SyncHook(),
    decision: new SyncHook(),
  };

  #active: TActiveRecord | null = null;
  #removeCrdtListener: (() => void) | null = null;

  constructor(private readonly args: TCanvasActiveSessionServiceArgs = {}) {}

  get active() {
    return this.#active?.session ?? null;
  }

  register(session: TCanvasActiveSession) {
    if (this.#active) {
      this.#cancel(this.#active, "replaced", null);
    }

    const record: TActiveRecord = {
      session,
      cancelled: false,
    };
    this.#active = record;
    this.hooks.change.call(session);

    return () => {
      if (this.#active !== record) {
        return;
      }

      this.#cancel(record, "disposed", null);
    };
  }

  complete(sessionId: string) {
    if (this.#active?.session.id !== sessionId) {
      return false;
    }

    this.#active = null;
    this.hooks.change.call(null);
    return true;
  }

  start() {
    if (this.#removeCrdtListener || !this.args.crdt) {
      return;
    }

    this.#removeCrdtListener = this.args.crdt.hooks.change.tap((summary) => {
      this.handleChange(summary);
    });
  }

  handleChange(summary: TCrdtChangeSummary): TCanvasActiveSessionDecision | null {
    const record = this.#active;
    if (!record) {
      return null;
    }

    const decision = fnClassifyActiveSessionChange(record.session, summary);
    if (
      decision.action === "cancel"
      && (
        decision.reason === "remote-element-fields-changed"
        || decision.reason === "remote-group-fields-changed"
      )
      && record.session.rebase?.(summary) === true
    ) {
      const rebasedDecision = {
        action: "rebase",
        sessionId: record.session.id,
        summaryRevision: summary.revision,
        reason: decision.reason,
      } satisfies TCanvasActiveSessionDecision;
      this.hooks.decision.call(rebasedDecision);
      return rebasedDecision;
    }

    this.hooks.decision.call(decision);
    if (decision.action === "cancel") {
      this.#cancel(record, decision.reason, summary);
    }
    return decision;
  }

  stop() {
    this.#removeCrdtListener?.();
    this.#removeCrdtListener = null;
    if (!this.#active) {
      return;
    }

    this.#cancel(this.#active, "destroy", null);
  }

  #cancel(
    record: TActiveRecord,
    reason: TCanvasActiveSessionCancelReason,
    summary: TCrdtChangeSummary | null,
  ) {
    if (record.cancelled) {
      return;
    }

    record.cancelled = true;
    if (this.#active === record) {
      this.#active = null;
    }
    record.session.cancel({
      sessionId: record.session.id,
      reason,
      summary,
    });
    this.hooks.change.call(null);
  }
}
