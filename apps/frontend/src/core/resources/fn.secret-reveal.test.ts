import { describe, expect, test } from "vitest";
import {
  fnCanApplySecretReveal,
  fnSecretRevealIdentityIsCurrent,
  type TSecretRevealRequestIdentity,
} from "./fn.secret-reveal";

const request: TSecretRevealRequestIdentity = {
  generation: 4,
  resourceId: "resource-1",
  name: "production/token",
  revision: 7,
};

const page = {
  kind: "secretStore" as const,
  entries: [{ name: "production/token", revision: 7 }],
};

describe("secret reveal guards", () => {
  test("accepts only the exact response for the currently displayed row", () => {
    expect(fnCanApplySecretReveal(
      request,
      4,
      "resource-1",
      "data",
      true,
      page,
      { kind: "secretStore", name: "production/token", revision: 7 },
    )).toBe(true);
  });

  test("rejects stale request generations and resource changes", () => {
    const response = { kind: "secretStore" as const, name: "production/token", revision: 7 };
    expect(fnCanApplySecretReveal(request, 5, "resource-1", "data", true, page, response)).toBe(false);
    expect(fnCanApplySecretReveal(request, 4, "resource-2", "data", true, page, response)).toBe(false);
    expect(fnCanApplySecretReveal(request, 4, "resource-1", "overview", true, page, response)).toBe(false);
    expect(fnCanApplySecretReveal(request, 4, "resource-1", "data", false, page, response)).toBe(false);
  });

  test("rejects a different response row or revision", () => {
    expect(fnCanApplySecretReveal(
      request,
      4,
      "resource-1",
      "data",
      true,
      page,
      { kind: "secretStore", name: "other", revision: 7 },
    )).toBe(false);
    expect(fnCanApplySecretReveal(
      request,
      4,
      "resource-1",
      "data",
      true,
      page,
      { kind: "secretStore", name: "production/token", revision: 8 },
    )).toBe(false);
  });

  test("rejects a response after the displayed row changes or disappears", () => {
    const response = { kind: "secretStore" as const, name: "production/token", revision: 7 };
    expect(fnCanApplySecretReveal(
      request,
      4,
      "resource-1",
      "data",
      true,
      { kind: "secretStore", entries: [{ name: "production/token", revision: 8 }] },
      response,
    )).toBe(false);
    expect(fnCanApplySecretReveal(
      request,
      4,
      "resource-1",
      "data",
      true,
      { kind: "secretStore", entries: [] },
      response,
    )).toBe(false);
  });

  test("retains plaintext only while its row identity remains current", () => {
    expect(fnSecretRevealIdentityIsCurrent(request, "resource-1", "data", page)).toBe(true);
    expect(fnSecretRevealIdentityIsCurrent(
      request,
      "resource-1",
      "data",
      { kind: "secretStore", entries: [{ name: request.name, revision: request.revision + 1 }] },
    )).toBe(false);
  });
});
