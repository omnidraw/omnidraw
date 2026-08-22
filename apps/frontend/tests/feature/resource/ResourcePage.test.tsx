import { render } from "@solidjs/web";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ResourcePage, { type TRouteResource } from "../../../src/shell/framework/pages/resource";
import { FrontendRuntimeProvider } from "../../../src/shell/framework/runtime-context";
import type { TFrontendRuntime } from "../../../src/shell/runtime/frontend-runtime";
import { settleSolidUpdate } from "../../settled";

const harness = vi.hoisted(() => ({
  params: { id: "resource-kv" },
}));

vi.mock("@solidjs/router", () => ({
  useParams: () => harness.params,
}));

vi.mock("../../../src/shell/framework/feature/resource/GenericResourcePage", () => ({
  GenericResourcePage: () => <div>generic resource workbench</div>,
}));

vi.mock("../../../src/shell/framework/feature/db-resource/DbResourcePage", () => ({
  DbResourcePage: () => <div>database resource workbench</div>,
}));

const resources: Record<string, TRouteResource> = {
  "resource-kv": {
    id: "resource-kv",
    kind: "kv",
    name: "Settings",
    status: "ready",
    createdAtSec: "1",
    updatedAtSec: "1",
  },
  "resource-db": {
    id: "resource-db",
    kind: "db",
    name: "Application database",
    status: "ready",
    createdAtSec: "1",
    updatedAtSec: "1",
  },
  "resource-secret": {
    id: "resource-secret",
    kind: "secretStore",
    name: "Retained secret store",
    status: "ready",
    createdAtSec: "1",
    updatedAtSec: "1",
  },
};

let dispose: (() => void) | undefined;
let warnings: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  harness.params.id = "resource-kv";
  warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await settleSolidUpdate();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("resource route", () => {
  test.each([
    ["resource-kv", "generic resource workbench"],
    ["resource-db", "database resource workbench"],
    ["resource-secret", "Secret Store resources are disabled."],
  ])("renders %s without untracked Show reads", async (resourceId, expectedText) => {
    harness.params.id = resourceId;
    const runtime = {
      api: {
        safeRequest: vi.fn(async () => [null, resources[resourceId]] as const),
      },
    } as unknown as TFrontendRuntime;
    const host = document.createElement("div");
    document.body.append(host);
    dispose = render(() => (
      <FrontendRuntimeProvider runtime={runtime}>
        <ResourcePage />
      </FrontendRuntimeProvider>
    ), host);

    await vi.waitFor(() => expect(host.textContent).toContain(expectedText));
    const diagnostics = warnings.mock.calls.flat().map(String).join("\n");
    expect(diagnostics).not.toContain("STRICT_READ_UNTRACKED");
  });
});
