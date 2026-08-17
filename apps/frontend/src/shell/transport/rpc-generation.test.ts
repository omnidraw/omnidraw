import { describe, expect, test } from "bun:test";
import { Effect, Stream } from "effect";
import { PrivateRpcError } from "@/core/app/private-rpc-error";
import {
  FrontendRpcClient,
  FrontendRpcConnection,
  FrontendRpcConnectionGenerations,
  FrontendRpcStaleGenerationError,
} from "./rpc";
import type {
  TPrivateStreamInput,
  TPrivateStreamOutput,
  TPrivateStreamPath,
} from "@/core/app/private-operation-contract";

function reconnectingStream(args: Readonly<{
  recover(): Promise<readonly Readonly<{ sequence: number }>[]>;
}>) {
  const generations = new FrontendRpcConnectionGenerations();
  generations.connected();
  const client = {
    "omnidraw.stream.v1": () => Stream.fromEffect(Effect.sync(() => {
      generations.disconnected();
      throw new Error("The original physical stream disconnected.");
    })),
  } as never;
  const connection = new FrontendRpcConnection({
    generations,
    runPromise: (program, options) => Effect.runPromise(
      Effect.provideService(program, FrontendRpcClient, client),
      options,
    ),
  });
  const iterator = connection.resumableStream({
    path: "agent.events",
    initialCursor: 0,
    input: (afterSequence) => ({ afterSequence }),
    advance: (_cursor, event) => event.sequence,
    afterReconnect: args.recover,
  })[Symbol.asyncIterator]();
  return { generations, iterator };
}

async function reconnectAfterStreamFailure(
  generations: FrontendRpcConnectionGenerations,
): Promise<void> {
  for (let attempt = 0; attempt < 100 && generations.snapshot().connected; attempt += 1) {
    await Promise.resolve();
  }
  expect(generations.snapshot().connected).toBe(false);
  generations.connected();
}

describe("frontend RPC connection generations", () => {
  test("increments on every physical connection and retires disconnect leases", () => {
    const generations = new FrontendRpcConnectionGenerations();
    const initial = generations.lease();

    generations.connected();
    expect(generations.snapshot()).toEqual({ connected: true, generation: 1 });
    expect(() => generations.assertCurrent(initial)).not.toThrow();

    generations.disconnected();
    expect(generations.snapshot()).toEqual({ connected: false, generation: 1 });
    expect(() => generations.assertCurrent(initial)).toThrow(FrontendRpcStaleGenerationError);

    const disconnected = generations.lease();
    generations.connected();
    expect(generations.snapshot()).toEqual({ connected: true, generation: 2 });
    expect(() => generations.assertCurrent(disconnected)).toThrow(FrontendRpcStaleGenerationError);
  });

  test("waits for a strictly newer connected generation", async () => {
    const generations = new FrontendRpcConnectionGenerations();
    generations.connected();
    const next = generations.waitForConnectionAfter(1);
    generations.disconnected();
    generations.connected();
    await expect(next).resolves.toEqual({ connected: true, generation: 2 });
  });

  test("retries a transient domain recovery inside the accepted generation", async () => {
    let attempts = 0;
    const { generations, iterator } = reconnectingStream({
      recover: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new PrivateRpcError({
            code: "SERVICE_UNAVAILABLE",
            status: 503,
            message: "Recovery authority is still starting.",
            details: null,
          });
        }
        return [{ sequence: 7 }];
      },
    });
    const event = iterator.next();
    await reconnectAfterStreamFailure(generations);
    await expect(event).resolves.toEqual({ done: false, value: { sequence: 7 } });
    expect(attempts).toBe(2);
    await iterator.return?.();
  });

  test("surfaces a non-retriable domain recovery failure", async () => {
    const failure = new PrivateRpcError({
      code: "CHAT_SCOPE_INVALID",
      status: 404,
      message: "The mounted chat scope no longer exists.",
      details: null,
    });
    const { generations, iterator } = reconnectingStream({
      recover: async () => { throw failure; },
    });
    const event = iterator.next();
    await reconnectAfterStreamFailure(generations);
    await expect(event).rejects.toBe(failure);
  });

  test("retires in-flight recovery and restarts it in the newest generation", async () => {
    let attempts = 0;
    let resolveRetired = (_events: readonly Readonly<{ sequence: number }>[]): void => undefined;
    const { generations, iterator } = reconnectingStream({
      recover: () => {
        attempts += 1;
        if (attempts === 1) {
          return new Promise((resolve) => {
            resolveRetired = resolve;
          });
        }
        return Promise.resolve([{ sequence: 9 }]);
      },
    });
    const event = iterator.next();
    await reconnectAfterStreamFailure(generations);
    for (let spin = 0; spin < 100 && attempts < 1; spin += 1) await Promise.resolve();
    expect(attempts).toBe(1);

    generations.disconnected();
    generations.connected();
    await expect(event).resolves.toEqual({ done: false, value: { sequence: 9 } });
    expect(attempts).toBe(2);

    resolveRetired([{ sequence: 7 }]);
    await iterator.return?.();
  });
});

describe("frontend RPC connected-domain recovery", () => {
  test("recovers a bounded replay gap without waiting for a physical reconnect", async () => {
    const generations = new FrontendRpcConnectionGenerations();
    const requests: number[] = [];
    let calls = 0;
    const gap = new PrivateRpcError({
      code: "EVENT_REPLAY_UNAVAILABLE",
      status: 409,
      message: "Replay gap.",
      details: { afterSequence: 0, earliestSequence: 282 },
    });
    const client = {
      "omnidraw.stream.v1": (payload: Readonly<{
        input: Readonly<{ afterSequence?: number }>;
      }>) => {
        requests.push(payload.input.afterSequence ?? 0);
        calls += 1;
        return calls === 1
          ? Stream.fail(gap)
          : Stream.concat(
              Stream.fromIterable([{ sequence: 282, kind: "widget-catalog", type: "changed" }]),
              Stream.never,
            );
      },
    } as never;
    generations.connected();
    const connection = new FrontendRpcConnection({
      generations,
      runPromise: (program, options) => Effect.runPromise(
        Effect.provideService(program, FrontendRpcClient, client),
        options,
      ),
    });
    let recoveryCalls = 0;
    const iterator = connection.resumableStream({
      path: "agent.events",
      initialCursor: 0,
      input: (afterSequence) => ({ afterSequence }),
      advance: (_cursor, event) => event.sequence,
      recoverAfterDomainError: async (error, cursor) => {
        expect(error).toBe(gap);
        expect(cursor).toBe(0);
        recoveryCalls += 1;
        return { cursor: 281, events: [{ kind: "recovered" as const }] };
      },
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { kind: "recovered" },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { sequence: 282, kind: "widget-catalog", type: "changed" },
    });
    expect(requests).toEqual([0, 281]);
    expect(recoveryCalls).toBe(1);
    expect(generations.snapshot()).toEqual({ connected: true, generation: 1 });
    await iterator.return?.();
  });

  test("aborting a resumable stream completes quietly without recovery or generation change", async () => {
    const generations = new FrontendRpcConnectionGenerations();
    const controller = new AbortController();
    let afterReconnect = 0;
    let recoverAfterDomainError = 0;
    const client = {
      "omnidraw.stream.v1": () => Stream.concat(
        Stream.fromIterable([{ sequence: 1, kind: "widget-catalog", type: "changed" }]),
        Stream.never,
      ),
    } as never;
    generations.connected();
    const connection = new FrontendRpcConnection({
      generations,
      runPromise: (program, options) => Effect.runPromise(
        Effect.provideService(program, FrontendRpcClient, client),
        options,
      ),
    });
    const iterator = connection.resumableStream({
      path: "agent.events",
      initialCursor: 0,
      input: (afterSequence) => ({ afterSequence }),
      advance: (_cursor, event) => event.sequence,
      recoverAfterDomainError: async () => {
        recoverAfterDomainError += 1;
        return null;
      },
      afterReconnect: async () => {
        afterReconnect += 1;
        return [];
      },
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { sequence: 1, kind: "widget-catalog", type: "changed" },
    });
    controller.abort();
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(generations.snapshot()).toEqual({ connected: true, generation: 1 });
    expect(afterReconnect).toBe(0);
    expect(recoverAfterDomainError).toBe(0);
  });

  test("keeps non-recoverable connected stream failures terminal", async () => {
    const generations = new FrontendRpcConnectionGenerations();
    const failure = new PrivateRpcError({
      code: "EVENT_CURSOR_INVALID",
      status: 409,
      message: "Future cursor.",
      details: null,
    });
    const client = {
      "omnidraw.stream.v1": () => Stream.fail(failure),
    } as never;
    generations.connected();
    const connection = new FrontendRpcConnection({
      generations,
      runPromise: (program, options) => Effect.runPromise(
        Effect.provideService(program, FrontendRpcClient, client),
        options,
      ),
    });
    const iterator = connection.resumableStream({
      path: "agent.events",
      initialCursor: 10,
      input: (afterSequence) => ({ afterSequence }),
      advance: (_cursor, event) => event.sequence,
      recoverAfterDomainError: async () => null,
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toBe(failure);
  });
});

type TResumableDomainCase<Path extends TPrivateStreamPath = TPrivateStreamPath> = Readonly<{
  path: Path;
  input(cursor: number): TPrivateStreamInput<Path>;
  cursor(input: TPrivateStreamInput<Path>): number;
  event(cursor: number): TPrivateStreamOutput<Path>;
  advance(cursor: number, event: TPrivateStreamOutput<Path>): number;
}>;

const RESUMABLE_DOMAIN_CASES = [
  {
    path: "agent.events",
    input: (afterSequence: number) => ({ afterSequence }),
    cursor: (input: Readonly<{ afterSequence?: number }>) => input.afterSequence ?? 0,
    event: (sequence: number) => ({ sequence, kind: "widget-catalog", type: "changed" }),
    advance: (cursor: number, event: Readonly<{ sequence: number }>) => Math.max(cursor, event.sequence),
  },
  {
    path: "canvas.events",
    input: (afterRevision: number) => ({ canvasId: "canvas-1", afterRevision }),
    cursor: (input: Readonly<{ afterRevision: number }>) => input.afterRevision,
    event: (revision: number) => ({ type: "resync-required" as const, canvasId: "canvas-1", revision }),
    advance: (cursor: number, event: Readonly<{ revision: number }>) => Math.max(cursor, event.revision),
  },
  {
    path: "db.events",
    input: (afterSequence: number) => ({ canvasId: "canvas-1", afterSequence }),
    cursor: (input: Readonly<{ afterSequence?: number }>) => input.afterSequence ?? 0,
    event: (sequence: number) => ({ sequence, data: { change: "delete" as const, table: "canvas_items", id: `item-${sequence}` } }),
    advance: (cursor: number, event: Readonly<{ sequence: number }>) => Math.max(cursor, event.sequence),
  },
  {
    path: "notification.events",
    input: (afterSequence: number) => ({ afterSequence }),
    cursor: (input: Readonly<{ afterSequence?: number }>) => input.afterSequence ?? 0,
    event: (sequence: number) => ({ sequence, type: "info" as const, title: `event-${sequence}` }),
    advance: (cursor: number, event: Readonly<{ sequence: number }>) => Math.max(cursor, event.sequence),
  },
  {
    path: "widget.catalog.events",
    input: (afterGeneration: number) => ({ afterGeneration }),
    cursor: (input: Readonly<{ afterGeneration?: number }>) => input.afterGeneration ?? 0,
    event: (generation: number) => ({ previousGeneration: generation - 1, generation, fullResync: false, changedWidgetKeys: [], previewWidgetKeys: [] }),
    advance: (cursor: number, event: Readonly<{ generation: number }>) => Math.max(cursor, event.generation),
  },
  {
    path: "widget.runtime.state.events",
    input: (afterVersion: number) => ({ canvasId: "canvas-1", elementId: "element-1", widgetInstanceId: "instance-1", afterVersion }),
    cursor: (input: Readonly<{ afterVersion?: number }>) => input.afterVersion ?? 0,
    event: (version: number) => ({ type: "changed" as const, snapshot: { version, state: null } }),
    advance: (cursor: number, event: Readonly<{ snapshot: Readonly<{ version: number }> }>) => Math.max(cursor, event.snapshot.version),
  },
] as const;

async function reconnectDomain<Path extends TPrivateStreamPath>(
  domain: TResumableDomainCase<Path>,
  terminal: boolean,
): Promise<void> {
  const generations = new FrontendRpcConnectionGenerations();
  const requests: TPrivateStreamInput<Path>[] = [];
  const failure = new PrivateRpcError({
    code: "EVENT_CURSOR_INVALID",
    status: 409,
    message: "The restarted authority rejected the retained cursor.",
    details: null,
  });
  const client = {
    "omnidraw.stream.v1": (payload: Readonly<{ input: TPrivateStreamInput<Path> }>) => {
      requests.push(payload.input);
      const generation = generations.snapshot().generation;
      if (generation === 1) {
        return Stream.concat(
          Stream.fromIterable([domain.event(5), domain.event(6)]),
          Stream.fromEffect(Effect.sync(() => generations.disconnected()).pipe(
            Effect.andThen(Effect.fail(new Error("physical disconnect"))),
          )),
        );
      }
      if (terminal) return Stream.fail(failure);
      return Stream.concat(
        Stream.fromIterable([domain.event(6), domain.event(7)]),
        Stream.never,
      );
    },
  } as never;
  generations.connected();
  const connection = new FrontendRpcConnection({
    generations,
    runPromise: (program, options) => Effect.runPromise(
      Effect.provideService(program, FrontendRpcClient, client),
      options,
    ),
  });
  const iterator = connection.resumableStream<Path, number>({
    path: domain.path,
    initialCursor: 5,
    input: domain.input,
    advance: domain.advance,
    isDuplicate: (cursor, event) => domain.advance(cursor, event) <= cursor,
  })[Symbol.asyncIterator]();

  await expect(iterator.next()).resolves.toEqual({ done: false, value: domain.event(6) });
  const recovered = iterator.next();
  await reconnectAfterStreamFailure(generations);
  if (terminal) {
    await expect(recovered).rejects.toBe(failure);
  } else {
    await expect(recovered).resolves.toEqual({ done: false, value: domain.event(7) });
    expect(requests.map(domain.cursor)).toEqual([5, 6]);
    await iterator.return?.();
  }
}

describe("frontend resumable domain matrix", () => {
  for (const domain of RESUMABLE_DOMAIN_CASES) {
    test(`${domain.path} resumes at its acknowledged cursor without duplicate delivery`, async () => {
      await reconnectDomain(domain as never, false);
    });

    test(`${domain.path} surfaces a terminal restart cursor failure`, async () => {
      await reconnectDomain(domain as never, true);
    });
  }
});
