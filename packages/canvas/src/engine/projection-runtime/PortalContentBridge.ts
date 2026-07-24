import type {
  TCanvasProjectedPortal,
  TCanvasProjectedPortalContent,
} from "../typed";
import type {
  TCanvasOwnedPortal,
  TCanvasPortalMountContext,
} from "../portals/PortalOwnership";
import type {
  ICanvasEngineOwnershipStage,
  TCanvasEngineOwnershipStageState,
} from "../interface";

export type TCanvasPortalContentUpdate = (
  content: TCanvasProjectedPortalContent,
) => void;

export type TCanvasPortalContentMountArgs = {
  portalId: string;
  elementId: string;
  host: HTMLDivElement;
  initialContent: TCanvasProjectedPortalContent;
  onContentUpdate(listener: TCanvasPortalContentUpdate): () => void;
};

export type TMountCanvasPortalContent = (
  args: TCanvasPortalContentMountArgs,
) => void | (() => void) | Promise<void | (() => void)>;

export type TCanvasPortalContentBridgeArgs = {
  mountContent: TMountCanvasPortalContent;
  onUpdateError?(args: { portalId: string; error: unknown }): void;
};

export class CanvasPortalContentMountError extends Error {
  readonly portalId: string;
  readonly cause: unknown;

  constructor(portalId: string, cause: unknown) {
    super(`Projected portal '${portalId}' content failed to mount.`);
    this.name = "CanvasPortalContentMountError";
    this.portalId = portalId;
    this.cause = cause;
  }
}

type TPortalContentStageData = {
  desired: Map<string, TPortalContentRecord>;
  state: TCanvasEngineOwnershipStageState;
};

type TPortalContentRecord = {
  elementId: string;
  content: TCanvasProjectedPortalContent;
};

function cloneContent(
  content: TCanvasProjectedPortalContent,
): TCanvasProjectedPortalContent {
  return JSON.parse(JSON.stringify(content)) as TCanvasProjectedPortalContent;
}

function contentSignature(content: TCanvasProjectedPortalContent): string {
  return JSON.stringify(content);
}

/**
 * Keeps portal mount identity stable while treating projected content as
 * separately committed, renderer-neutral state.
 */
export class PortalContentBridge {
  readonly #mountContent: TMountCanvasPortalContent;
  readonly #onUpdateError:
    | ((args: { portalId: string; error: unknown }) => void)
    | undefined;
  readonly #current = new Map<string, TPortalContentRecord>();
  readonly #subscribers = new Map<string, Set<TCanvasPortalContentUpdate>>();
  readonly #mounts = new Map<
    string,
    (context: TCanvasPortalMountContext) => Promise<void | (() => void)>
  >();
  #pending: TPortalContentStageData | null = null;
  #destroyed = false;

  constructor(args: TCanvasPortalContentBridgeArgs) {
    this.#mountContent = args.mountContent;
    this.#onUpdateError = args.onUpdateError;
  }

  ownedPortal(portal: TCanvasProjectedPortal): TCanvasOwnedPortal {
    this.#assertOperational();
    let mount = this.#mounts.get(portal.portalId);
    if (mount === undefined) {
      mount = (context) => this.#mount(portal.portalId, context);
      this.#mounts.set(portal.portalId, mount);
    }
    return {
      portalId: portal.portalId,
      registrationKey: `vibecanvas:projection-portal:${portal.portalId}`,
      interactive: portal.interactive,
      mount,
    };
  }

  stage(
    portals: readonly TCanvasProjectedPortal[],
  ): ICanvasEngineOwnershipStage {
    this.#assertOperational();
    if (this.#pending !== null) {
      throw new TypeError("Portal content already has an active ownership stage.");
    }
    const desired = new Map<string, TPortalContentRecord>();
    for (const portal of portals) {
      if (desired.has(portal.portalId)) {
        throw new TypeError(`Duplicate projected portal '${portal.portalId}'.`);
      }
      desired.set(portal.portalId, {
        elementId: portal.elementId,
        content: cloneContent(portal.content),
      });
    }
    const data: TPortalContentStageData = {
      desired,
      state: "staged",
    };
    this.#pending = data;
    return {
      label: "portal-content:vibecanvas:projection",
      get state() {
        return data.state;
      },
      prepare: async () => {
        if (data.state === "prepared") {
          return;
        }
        if (data.state !== "staged") {
          throw new TypeError(`Cannot prepare portal content from '${data.state}'.`);
        }
        data.state = "prepared";
      },
      commit: async () => {
        if (data.state === "committed") {
          return;
        }
        if (data.state !== "prepared") {
          throw new TypeError(`Cannot commit portal content from '${data.state}'.`);
        }
        this.#commit(data);
      },
      rollback: async () => {
        if (data.state === "rolled-back" || data.state === "committed") {
          return;
        }
        data.state = "rolled-back";
        if (this.#pending === data) {
          this.#pending = null;
        }
      },
    };
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    if (this.#pending !== null && this.#pending.state !== "committed") {
      this.#pending.state = "rolled-back";
    }
    this.#pending = null;
    this.#current.clear();
    this.#subscribers.clear();
    this.#mounts.clear();
  }

  async #mount(
    portalId: string,
    context: TCanvasPortalMountContext,
  ): Promise<void | (() => void)> {
    this.#assertOperational();
    const initial = this.#current.get(portalId)
      ?? this.#pending?.desired.get(portalId);
    if (initial === undefined) {
      throw new TypeError(`Projected portal '${portalId}' has no staged content.`);
    }
    const mountSubscriptions = new Set<TCanvasPortalContentUpdate>();
    const onContentUpdate = (listener: TCanvasPortalContentUpdate): (() => void) => {
      let subscribers = this.#subscribers.get(portalId);
      if (subscribers === undefined) {
        subscribers = new Set();
        this.#subscribers.set(portalId, subscribers);
      }
      subscribers.add(listener);
      mountSubscriptions.add(listener);
      let active = true;
      return () => {
        if (!active) {
          return;
        }
        active = false;
        subscribers?.delete(listener);
        mountSubscriptions.delete(listener);
      };
    };

    try {
      const dispose = await this.#mountContent({
        portalId,
        elementId: initial.elementId,
        host: context.host,
        initialContent: cloneContent(initial.content),
        onContentUpdate,
      });
      return () => {
        const subscribers = this.#subscribers.get(portalId);
        for (const listener of mountSubscriptions) {
          subscribers?.delete(listener);
        }
        mountSubscriptions.clear();
        if (subscribers?.size === 0) {
          this.#subscribers.delete(portalId);
        }
        dispose?.();
      };
    } catch (error) {
      const subscribers = this.#subscribers.get(portalId);
      for (const listener of mountSubscriptions) {
        subscribers?.delete(listener);
      }
      if (subscribers?.size === 0) {
        this.#subscribers.delete(portalId);
      }
      throw new CanvasPortalContentMountError(portalId, error);
    }
  }

  #commit(data: TPortalContentStageData): void {
    const previous = this.#current;
    for (const portalId of [...previous.keys()]) {
      if (!data.desired.has(portalId)) {
        previous.delete(portalId);
        this.#subscribers.delete(portalId);
      }
    }
    for (const [portalId, record] of data.desired) {
      const oldRecord = previous.get(portalId);
      if (
        oldRecord !== undefined
        && oldRecord.elementId !== record.elementId
      ) {
        throw new TypeError(
          `Projected portal '${portalId}' changed product element identity.`,
        );
      }
      const changed = oldRecord === undefined
        || contentSignature(oldRecord.content) !== contentSignature(record.content);
      const committed = cloneContent(record.content);
      previous.set(portalId, {
        elementId: record.elementId,
        content: committed,
      });
      if (!changed || oldRecord === undefined) {
        continue;
      }
      for (const listener of this.#subscribers.get(portalId) ?? []) {
        try {
          listener(cloneContent(committed));
        } catch (error) {
          this.#onUpdateError?.({ portalId, error });
        }
      }
    }
    data.state = "committed";
    if (this.#pending === data) {
      this.#pending = null;
    }
  }

  #assertOperational(): void {
    if (this.#destroyed) {
      throw new TypeError("PortalContentBridge is destroyed.");
    }
  }
}
