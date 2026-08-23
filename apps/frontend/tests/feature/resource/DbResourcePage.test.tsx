import { render } from "@solidjs/web";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  TDbApplyDetails,
  TDbApplyRun,
  TDbDraft,
  TDbImpact,
  TResource,
} from "../../../src/core/resources/types";
import { DbResourcePage } from "../../../src/shell/framework/feature/db-resource/DbResourcePage";
import { FrontendRuntimeProvider } from "../../../src/shell/framework/runtime-context";
import type { TFrontendRuntime } from "../../../src/shell/runtime/frontend-runtime";
import { settleSolidUpdate } from "../../settled";

const router = vi.hoisted(() => ({
  navigate: vi.fn(),
  searchParams: { tab: "overview", object: undefined as string | undefined },
  setSearchParams: vi.fn(),
}));

vi.mock("@solidjs/router", () => ({
  useNavigate: () => router.navigate,
  useSearchParams: () => [router.searchParams, router.setSearchParams],
}));

vi.mock("../../../src/shell/framework/feature/db-resource/components/ConfirmActionDialog", () => ({
  ConfirmActionDialog: () => null,
}));
vi.mock("../../../src/shell/framework/feature/db-resource/components/CoordinatedOperationDialog", () => ({
  CoordinatedOperationDialog: () => null,
}));
vi.mock("../../../src/shell/framework/feature/db-resource/components/LiveSqlApprovalDialog", () => ({
  LiveSqlApprovalDialog: () => null,
}));
vi.mock("../../../src/shell/framework/feature/db-resource/components/ObjectInspector", () => ({
  ObjectInspector: () => null,
}));
vi.mock("../../../src/shell/framework/feature/db-resource/components/RowEditorDialog", () => ({
  RowEditorDialog: () => null,
}));
vi.mock("../../../src/shell/framework/feature/db-resource/components/StructureChangeDialog", () => ({
  StructureChangeDialog: () => null,
}));

const resource: TResource = {
  id: "resource-db",
  kind: "db",
  name: "Application database",
  status: "ready",
  lastError: null,
  createdAtSec: "1",
  updatedAtSec: "1",
};

const impact: TDbImpact = {
  resource,
  uses: { resourceId: resource.id, uses: [] },
};

const pendingApply: TDbApplyRun = {
  id: "apply-pending",
  resourceId: resource.id,
  draftId: null,
  sourceApplyId: null,
  status: "applying",
  lastError: null,
  backupRetained: false,
  createdAtSec: "1",
  completedAtSec: null,
};

const pendingApplyDetails: TDbApplyDetails = {
  apply: pendingApply,
  drain: null,
};

const activeDraft: TDbDraft = {
  id: "draft-a",
  resourceId: resource.id,
  name: "Draft A",
  status: "editing",
  lastError: null,
  createdAtSec: "1",
  updatedAtSec: "1",
  appliedAtSec: null,
};

type TPollObserver = Readonly<{
  onSuccess?(value: TDbApplyDetails): void;
  onError?(error: { message: string }): void;
}>;

type TSafeResult = readonly [null, unknown];

function deferredResult() {
  let resolve!: (value: TSafeResult) => void;
  const promise = new Promise<TSafeResult>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function renderPage(
  runSafe: ReturnType<typeof vi.fn>,
  fork: ReturnType<typeof vi.fn>,
  resourceId: string | (() => string) = resource.id,
) {
  const runtime = { runSafe, fork } as unknown as TFrontendRuntime;
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => (
    <FrontendRuntimeProvider runtime={runtime}>
      <DbResourcePage resourceId={typeof resourceId === "function" ? resourceId() : resourceId} />
    </FrontendRuntimeProvider>
  ), host);
  return { dispose, host };
}

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await settleSolidUpdate();
  document.body.replaceChildren();
  router.searchParams.tab = "overview";
  router.searchParams.object = undefined;
  vi.clearAllMocks();
});

describe("DbResourcePage lifecycle", () => {
  test("invalidates a pending metadata load before disposal can start operation polling", async () => {
    const metadata = Array.from({ length: 6 }, deferredResult);
    const runSafe = vi.fn((_program: unknown) => {
      const request = metadata[runSafe.mock.calls.length - 1];
      return request?.promise ?? Promise.resolve([null, pendingApplyDetails] as const);
    });
    const fork = vi.fn((_program: unknown, _observer?: TPollObserver) => () => undefined);
    const rendered = renderPage(runSafe, fork);
    dispose = rendered.dispose;

    await vi.waitFor(() => expect(runSafe).toHaveBeenCalledTimes(6));
    dispose();
    dispose = undefined;

    metadata[0]!.resolve([null, resource]);
    metadata[1]!.resolve([null, impact]);
    metadata[2]!.resolve([null, []]);
    metadata[3]!.resolve([null, null]);
    metadata[4]!.resolve([null, [pendingApply]]);
    metadata[5]!.resolve([null, null]);
    await settleSolidUpdate();
    await settleSolidUpdate();

    expect(runSafe).toHaveBeenCalledTimes(6);
    expect(fork).not.toHaveBeenCalled();
  });

  test("ignores a completed operation callback after disposal", async () => {
    const runSafe = vi.fn()
      .mockResolvedValueOnce([null, resource])
      .mockResolvedValueOnce([null, impact])
      .mockResolvedValueOnce([null, []])
      .mockResolvedValueOnce([null, null])
      .mockResolvedValueOnce([null, [pendingApply]])
      .mockResolvedValueOnce([null, null])
      .mockResolvedValueOnce([null, pendingApplyDetails]);
    const fork = vi.fn((_program: unknown, _observer?: TPollObserver) => () => undefined);
    const rendered = renderPage(runSafe, fork);
    dispose = rendered.dispose;

    await vi.waitFor(() => expect(fork).toHaveBeenCalledOnce());
    const observer = fork.mock.calls[0]?.[1] as TPollObserver | undefined;
    expect(observer).toBeDefined();

    dispose();
    dispose = undefined;
    runSafe.mockClear();
    observer?.onSuccess?.(pendingApplyDetails);
    await settleSolidUpdate();

    expect(runSafe).not.toHaveBeenCalled();
  });

  test("rejects an old operation callback as soon as the resource identity changes", async () => {
    const runSafe = vi.fn()
      .mockResolvedValueOnce([null, resource])
      .mockResolvedValueOnce([null, impact])
      .mockResolvedValueOnce([null, []])
      .mockResolvedValueOnce([null, null])
      .mockResolvedValueOnce([null, [pendingApply]])
      .mockResolvedValueOnce([null, null])
      .mockResolvedValueOnce([null, pendingApplyDetails])
      .mockResolvedValue([null, null]);
    const cancelPoll = vi.fn();
    const fork = vi.fn((_program: unknown, _observer?: TPollObserver) => cancelPoll);
    const [resourceId, setResourceId] = createSignal(resource.id);
    const rendered = renderPage(runSafe, fork, resourceId);
    dispose = rendered.dispose;

    await vi.waitFor(() => expect(fork).toHaveBeenCalledOnce());
    const observer = fork.mock.calls[0]?.[1] as TPollObserver | undefined;
    runSafe.mockClear();
    setResourceId("resource-db-next");
    observer?.onSuccess?.(pendingApplyDetails);

    expect(runSafe).not.toHaveBeenCalled();
    await settleSolidUpdate();
    expect(cancelPoll).toHaveBeenCalledOnce();
  });

  test("invalidates pending inspection and row continuations on disposal", async () => {
    router.searchParams.tab = "data";
    router.searchParams.object = "users";
    const requests = Array.from({ length: 8 }, deferredResult);
    const runSafe = vi.fn(() => requests[runSafe.mock.calls.length - 1]!.promise);
    const fork = vi.fn((_program: unknown, _observer?: TPollObserver) => () => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rendered = renderPage(runSafe, fork);
    dispose = rendered.dispose;

    await vi.waitFor(() => expect(runSafe).toHaveBeenCalledTimes(6));
    requests[0]!.resolve([null, resource]);
    requests[1]!.resolve([null, impact]);
    for (const request of requests.slice(2, 6)) request.resolve([null, null]);
    await vi.waitFor(() => expect(runSafe).toHaveBeenCalledTimes(8));
    dispose();
    dispose = undefined;
    for (const request of requests.slice(6)) request.resolve([null, null]);
    await settleSolidUpdate();
    await settleSolidUpdate();

    expect(warn.mock.calls.flat().map(String).join("\n")).not.toMatch(/STRICT_READ_UNTRACKED|REACTIVE_WRITE|REACTIVITY_HALTED/);
    warn.mockRestore();
  });

  test("does not inspect an old draft under a newly routed resource identity", async () => {
    router.searchParams.tab = "schema";
    const oldInspection = deferredResult();
    const nextMetadata = Array.from({ length: 6 }, deferredResult);
    const initialResults: unknown[] = [
      resource,
      impact,
      [activeDraft],
      { draft: activeDraft, changes: [] },
      [],
      null,
      { draft: activeDraft, changes: [] },
    ];
    let requestIndex = 0;
    const runSafe = vi.fn(() => {
      const index = requestIndex++;
      if (index < initialResults.length) {
        return Promise.resolve([null, initialResults[index]] as const);
      }
      if (index === initialResults.length) return oldInspection.promise;
      return nextMetadata[index - initialResults.length - 1]?.promise
        ?? Promise.resolve([null, null] as const);
    });
    const fork = vi.fn((_program: unknown, _observer?: TPollObserver) => () => undefined);
    const [resourceId, setResourceId] = createSignal(resource.id);
    const rendered = renderPage(runSafe, fork, resourceId);
    dispose = rendered.dispose;

    await vi.waitFor(() => expect(runSafe).toHaveBeenCalledTimes(8));
    setResourceId("resource-db-next");
    await vi.waitFor(() => expect(runSafe).toHaveBeenCalledTimes(14));
    await settleSolidUpdate();

    // Six pending metadata requests for B are valid. A seventh request here
    // would be the invalid mixed identity: inspect draft A as resource B.
    expect(runSafe).toHaveBeenCalledTimes(14);
  });
});
