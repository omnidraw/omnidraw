import { expect, test } from "bun:test";
import { PRIVATE_REQUEST_PATHS } from "@/core/app/private-operation-contract";
import type { TBackendCanvas } from "@/core/app/backend.types";
import type { TSafeResult } from "../framework/feature/sidebar/ports";
import {
  FRONTEND_IDEMPOTENT_MUTATION_PATHS,
  frontendIdempotencyKey,
  type TFrontendApi,
} from "./frontend-api";

declare const compileOnlyApi: TFrontendApi;

if (false) {
  const createResult: Promise<TSafeResult<TBackendCanvas>> = compileOnlyApi.safeRequest(
    "canvas.create",
    { name: "Typed canvas" },
  );
  void createResult;

  // @ts-expect-error canvas.create cannot accept another operation's input.
  compileOnlyApi.safeRequest("canvas.create", { resourceId: "resource-1" });
  // @ts-expect-error callers cannot select a result type independently of the path.
  compileOnlyApi.safeRequest<TBackendCanvas>("canvas.create", { name: "Cast result" });
}

test("every request operation has one explicit replay classification", () => {
  expect([...FRONTEND_IDEMPOTENT_MUTATION_PATHS]).toEqual([
    "canvas.remove",
    "canvas.execute",
    "widget.deletion.commit",
  ]);
  for (const path of PRIVATE_REQUEST_PATHS) {
    expect(typeof FRONTEND_IDEMPOTENT_MUTATION_PATHS.has(path)).toBe("boolean");
  }
});

test("Canvas commands and deletion reuse their authority keys while other calls never receive replay keys", () => {
  expect(frontendIdempotencyKey("canvas.execute", { commandId: "command-1" })).toBe("command-1");
  expect(frontendIdempotencyKey("canvas.execute", { commandId: "command-1" }, "command-1")).toBe("command-1");
  expect(frontendIdempotencyKey("canvas.remove", { deletionId: "deletion-1" })).toBe("deletion-1");
  expect(frontendIdempotencyKey("canvas.remove", { deletionId: "deletion-1" }, "deletion-1")).toBe("deletion-1");
  expect(frontendIdempotencyKey("canvas.execute", {})).toBeUndefined();
  expect(frontendIdempotencyKey("resource.resources.create", {}, "unsafe-key")).toBeUndefined();
  expect(frontendIdempotencyKey("agent.chat.prompt", {}, "unsafe-key")).toBeUndefined();
});
