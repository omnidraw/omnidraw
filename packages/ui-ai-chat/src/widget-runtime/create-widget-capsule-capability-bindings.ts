import type {
  CapsuleCapabilityBinding,
  CapsuleKernelCallContext,
  CapsuleKernelHostStream,
  CapsuleKernelHostStreamSink,
  CapsuleKernelStreamCancelReason,
  CapsuleKernelStreamContext,
} from '@omnidraw/capsule-omnidraw/capabilities';
import type { TWidgetBrowserFunctionDescriptor } from '@omnidraw/widget-contract';
import { fnResolveWidgetCapsuleCapabilities } from './fn.capsule-catalog';
import type {
  TWidgetCapsuleMountCatalog,
  TWidgetCollaborativeStateBridge,
  TWidgetCollaborativeStateSnapshot,
  TWidgetFunctionHostBridge,
} from './interface';

type TCreateWidgetCapsuleCapabilityBindingsArgs = Readonly<{
  catalog: TWidgetCapsuleMountCatalog;
  requests: Parameters<typeof fnResolveWidgetCapsuleCapabilities>[1];
  functionDescriptors: readonly TWidgetBrowserFunctionDescriptor[];
  functionBridge: TWidgetFunctionHostBridge;
  collaborativeStateBridge: TWidgetCollaborativeStateBridge | null;
  createStreamId(): string;
}>;

function exactFunctionOperations(
  descriptors: readonly TWidgetBrowserFunctionDescriptor[],
  operations: readonly string[],
): boolean {
  const expected = descriptors.map((descriptor) => descriptor.exportName).sort();
  const actual = [...operations].sort();
  return expected.length === actual.length
    && expected.every((name, index) => name === actual[index]);
}

function collaborativeStateChangeInput(value: unknown): unknown {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || Reflect.ownKeys(value).length !== 1
    || !Object.hasOwn(value, 'value')
  ) {
    throw new TypeError('Widget collaborative-state change input is invalid.');
  }
  return (value as Readonly<{ value: unknown }>).value;
}

class WidgetCollaborativeStateStream implements CapsuleKernelHostStream {
  readonly #bridge: TWidgetCollaborativeStateBridge;
  readonly #createStreamId: () => string;
  readonly #onCancelled: () => void;
  #sink: CapsuleKernelHostStreamSink | undefined;
  #lastVersion = 0;
  #demandEvents = 0;
  #pendingWaitId: string | undefined;
  #pumping = false;
  #cancelled = false;

  constructor(
    bridge: TWidgetCollaborativeStateBridge,
    createStreamId: () => string,
    onCancelled: () => void,
  ) {
    this.#bridge = bridge;
    this.#createStreamId = createStreamId;
    this.#onCancelled = onCancelled;
  }

  start(sink: CapsuleKernelHostStreamSink): void {
    if (this.#sink !== undefined || this.#cancelled) {
      throw new Error('Widget collaborative-state stream cannot be started twice.');
    }
    this.#sink = sink;
    this.#schedulePump();
  }

  request(demand: Readonly<{ events: number; bytes: number }>): void {
    if (this.#cancelled) return;
    this.#demandEvents = Math.min(
      Number.MAX_SAFE_INTEGER,
      this.#demandEvents + demand.events,
    );
    this.#schedulePump();
  }

  cancel(_reason: CapsuleKernelStreamCancelReason): void {
    if (this.#cancelled) return;
    this.#cancelled = true;
    if (this.#pendingWaitId !== undefined) {
      this.#bridge.cancel(this.#pendingWaitId);
      this.#pendingWaitId = undefined;
    }
    this.#onCancelled();
  }

  #schedulePump(): void {
    if (
      this.#pumping
      || this.#cancelled
      || this.#sink === undefined
      || this.#demandEvents < 1
    ) return;
    this.#pumping = true;
    void this.#pump()
      .catch(() => {
        if (this.#cancelled) return;
        this.#sink?.error();
        this.cancel({ code: 'provider-failure' });
      })
      .finally(() => {
        this.#pumping = false;
        this.#schedulePump();
      });
  }

  async #pump(): Promise<void> {
    while (
      !this.#cancelled
      && this.#sink !== undefined
      && this.#demandEvents > 0
    ) {
      let snapshot: TWidgetCollaborativeStateSnapshot;
      if (this.#lastVersion === 0) {
        snapshot = await this.#bridge.get();
      } else {
        const waitId = this.#createStreamId();
        this.#pendingWaitId = waitId;
        try {
          snapshot = await this.#bridge.next(this.#lastVersion, waitId);
        } finally {
          if (this.#pendingWaitId === waitId) this.#pendingWaitId = undefined;
        }
      }
      if (this.#cancelled || this.#sink === undefined) return;
      if (snapshot.version <= this.#lastVersion) {
        throw new Error('Widget collaborative-state stream version did not advance.');
      }
      this.#lastVersion = snapshot.version;
      this.#demandEvents -= 1;
      const result = await this.#sink.event(snapshot);
      if (result === 'rejected') {
        this.cancel({ code: 'overflow' });
        return;
      }
    }
  }
}

function serverFunctionBinding(
  descriptor: TCreateWidgetCapsuleCapabilityBindingsArgs['catalog']['capabilities'][number]['descriptor'],
  functionBridge: TWidgetFunctionHostBridge,
): CapsuleCapabilityBinding {
  let disposed = false;
  return Object.freeze({
    descriptor,
    async invoke(
      context: CapsuleKernelCallContext,
      operation: string,
      input: unknown,
    ): Promise<unknown> {
      if (disposed) throw new Error('Widget server-function provider is disposed.');
      return await functionBridge.invoke({
        functionName: operation,
        input,
        signal: context.signal,
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      functionBridge.dispose();
    },
  });
}

function collaborativeStateBinding(
  descriptor: TCreateWidgetCapsuleCapabilityBindingsArgs['catalog']['capabilities'][number]['descriptor'],
  bridge: TWidgetCollaborativeStateBridge,
  createStreamId: () => string,
): CapsuleCapabilityBinding {
  let disposed = false;
  const streams = new Set<WidgetCollaborativeStateStream>();
  return Object.freeze({
    descriptor,
    async invoke(
      _context: CapsuleKernelCallContext,
      operation: string,
      input: unknown,
    ): Promise<unknown> {
      if (disposed) throw new Error('Widget collaborative-state provider is disposed.');
      if (operation === 'get') {
        if (input !== null) throw new TypeError('Widget collaborative-state get input is invalid.');
        return await bridge.get();
      }
      if (operation === 'change') {
        return await bridge.change(collaborativeStateChangeInput(input) as never);
      }
      throw new Error('Widget collaborative-state call operation is unavailable.');
    },
    openStream(
      _context: CapsuleKernelStreamContext,
      operation: string,
      input: unknown,
    ): CapsuleKernelHostStream {
      if (disposed) throw new Error('Widget collaborative-state provider is disposed.');
      if (operation !== 'subscribe' || input !== null) {
        throw new TypeError('Widget collaborative-state stream request is invalid.');
      }
      let stream: WidgetCollaborativeStateStream;
      stream = new WidgetCollaborativeStateStream(
        bridge,
        createStreamId,
        () => streams.delete(stream),
      );
      streams.add(stream);
      return stream;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const stream of streams) stream.cancel({ code: 'destroy' });
      streams.clear();
      bridge.dispose();
    },
  });
}

export function createWidgetCapsuleCapabilityBindings(
  args: TCreateWidgetCapsuleCapabilityBindingsArgs,
): readonly CapsuleCapabilityBinding[] {
  const resolved = fnResolveWidgetCapsuleCapabilities(args.catalog, args.requests);
  return Object.freeze(resolved.map(({ request, catalogEntry }) => {
    if (catalogEntry.kind === 'server-functions') {
      if (!exactFunctionOperations(args.functionDescriptors, request.operations)) {
        throw new Error('Widget server-function descriptor catalog does not match runtime metadata.');
      }
      return serverFunctionBinding(catalogEntry.descriptor, args.functionBridge);
    }
    if (args.collaborativeStateBridge === null) {
      throw new Error('Widget collaborative state is not configured for this instance.');
    }
    return collaborativeStateBinding(
      catalogEntry.descriptor,
      args.collaborativeStateBridge,
      args.createStreamId,
    );
  }));
}
