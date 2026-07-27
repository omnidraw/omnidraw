import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { SyncHook } from "@vibecanvas/tapable";
import { describe, expect, test, vi } from "vitest";
import type {
  ICanvasProjectionCoordinatorPort,
} from "../../src/services/projection/CrdtProjectionService";
import { CrdtProjectionService } from "../../src/services/projection/CrdtProjectionService";
import type {
  TCrdtChangeSummary,
} from "../../src/services/crdt/CrdtService";
import type {
  TCanvasProjectionCoordinatorResult,
  TCanvasProjectionUpdate,
} from "../../src/engine/ProjectionCoordinator";

function document(id = "doc"): TCanvasDoc {
  return {
    id,
    name: id,
    elements: {},
    groups: {},
  };
}

function result(
  revision: number,
  origin: "initial" | "local" | "remote" = "remote",
): TCanvasProjectionCoordinatorResult {
  return {
    status: "applied",
    revision,
    origin,
    mode: revision === 0 ? "replace" : "diff",
  };
}

function summary(
  revision: number,
  origin: "local" | "remote",
  fullReload = false,
): TCrdtChangeSummary {
  return {
    revision,
    origin,
    fullReload,
    elements: {
      added: [],
      updated: [],
      deleted: [],
      changes: {},
    },
    groups: {
      added: [],
      updated: [],
      deleted: [],
      changes: {},
    },
  };
}

function harness(args?: {
  initialResult?: TCanvasProjectionCoordinatorResult;
  enqueueResult?: (
    update: TCanvasProjectionUpdate,
  ) => TCanvasProjectionCoordinatorResult | Promise<TCanvasProjectionCoordinatorResult>;
}) {
  let revision = 0;
  let currentDocument = document();
  const change = new SyncHook<[TCrdtChangeSummary]>();
  const coordinator: ICanvasProjectionCoordinatorPort = {
    hydrateInitial: vi.fn(async (_document, nextRevision) => {
      return args?.initialResult ?? result(nextRevision, "initial");
    }),
    enqueue: vi.fn(async (update) => {
      return args?.enqueueResult?.(update) ?? result(update.revision, update.origin);
    }),
    stop: vi.fn(),
  };
  const crdt = {
    doc: () => currentDocument,
    get revision() {
      return revision;
    },
    hooks: {
      change,
      write: new SyncHook(),
    },
  };
  const service = new CrdtProjectionService({ crdt, coordinator });

  return {
    service,
    coordinator,
    change(nextDocument: TCanvasDoc, nextSummary: TCrdtChangeSummary) {
      currentDocument = nextDocument;
      revision = nextSummary.revision;
      change.call(nextSummary);
    },
  };
}

describe("CrdtProjectionService", () => {
  test("hydrates the current authoritative snapshot before becoming ready", async () => {
    const test = harness();
    const results: TCanvasProjectionCoordinatorResult[] = [];
    test.service.hooks.result.tap((value) => results.push(value));

    await test.service.start();

    expect(test.coordinator.hydrateInitial).toHaveBeenCalledWith(
      expect.objectContaining({ id: "doc" }),
      0,
    );
    expect(test.service.state).toBe("running");
    expect(results).toEqual([result(0, "initial")]);
  });

  test("forwards local and remote summaries through the same document path", async () => {
    const test = harness();
    await test.service.start();

    test.change(document("local"), summary(1, "local"));
    test.change(document("remote"), summary(2, "remote", true));
    await test.service.stop();

    expect(test.coordinator.enqueue).toHaveBeenNthCalledWith(1, {
      document: expect.objectContaining({ id: "local" }),
      revision: 1,
      origin: "local",
      fullReload: false,
      changes: {
        elements: { added: [], updated: [], deleted: [] },
        groups: { added: [], updated: [], deleted: [] },
      },
    });
    expect(test.coordinator.enqueue).toHaveBeenNthCalledWith(2, {
      document: expect.objectContaining({ id: "remote" }),
      revision: 2,
      origin: "remote",
      fullReload: true,
      changes: {
        elements: { added: [], updated: [], deleted: [] },
        groups: { added: [], updated: [], deleted: [] },
      },
    });
  });

  test("subscribes before async initial hydration so intervening changes queue", async () => {
    let resolveInitial!: (value: TCanvasProjectionCoordinatorResult) => void;
    const initial = new Promise<TCanvasProjectionCoordinatorResult>((resolve) => {
      resolveInitial = resolve;
    });
    const test = harness({
      initialResult: await Promise.resolve(result(0, "initial")),
    });
    vi.mocked(test.coordinator.hydrateInitial).mockReturnValueOnce(initial);

    const starting = test.service.start();
    test.change(document("during-start"), summary(1, "remote"));
    resolveInitial(result(0, "initial"));
    await starting;
    await test.service.stop();

    expect(test.coordinator.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({ id: "during-start" }),
        revision: 1,
      }),
    );
  });

  test("surfaces initial failure and performs deterministic teardown", async () => {
    const failure = new Error("initial apply failed");
    const test = harness({
      initialResult: {
        status: "failed",
        revision: 0,
        origin: "initial",
        error: failure,
      },
    });
    const errors: unknown[] = [];
    test.service.hooks.error.tap((error) => errors.push(error));

    await expect(test.service.start()).rejects.toBe(failure);

    expect(errors).toEqual([failure]);
    expect(test.coordinator.stop).toHaveBeenCalledTimes(1);
    expect(test.service.state).toBe("stopped");
  });

  test("reports incremental failures without dropping later summaries", async () => {
    const failure = new Error("revision one failed");
    const test = harness({
      enqueueResult: (update) => update.revision === 1
        ? {
            status: "failed",
            revision: 1,
            origin: update.origin,
            error: failure,
          }
        : result(update.revision, update.origin),
    });
    const errors: Array<[unknown, number]> = [];
    test.service.hooks.error.tap((error, revision) => {
      errors.push([error, revision]);
    });
    await test.service.start();

    test.change(document("one"), summary(1, "remote"));
    test.change(document("two"), summary(2, "remote"));
    await test.service.stop();

    expect(errors).toEqual([[failure, 1]]);
    expect(test.coordinator.enqueue).toHaveBeenCalledTimes(2);
  });

  test("stop is idempotent and detaches future change delivery", async () => {
    const test = harness();
    await test.service.start();

    await Promise.all([test.service.stop(), test.service.stop()]);
    test.change(document("late"), summary(1, "remote"));

    expect(test.coordinator.stop).toHaveBeenCalledTimes(1);
    expect(test.coordinator.enqueue).not.toHaveBeenCalled();
    expect(test.service.state).toBe("stopped");
    await expect(test.service.start()).rejects.toThrow(
      "cannot start from 'stopped'",
    );
  });
});
