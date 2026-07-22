import { describe, expect, test, vi } from "vitest";
import type { TLegacyActorUiCapability } from "@vibecanvas/ui-ai-chat";
import type { TCreateLegacyActorUiCapabilityArgs } from "@vibecanvas/ui-actor-legacy";
import { configureLegacyActorUiStartup } from "./legacy-actor-ui-startup";

const capability = Object.freeze({
  kind: "legacy-actor-ui",
}) as unknown as TLegacyActorUiCapability;

const args = Object.freeze({
  browser: {},
  transport: {},
}) as TCreateLegacyActorUiCapabilityArgs;

function health(body: unknown, ok = true) {
  return {
    ok,
    json: vi.fn(async () => body),
  };
}

describe("legacy actor UI startup composition", () => {
  test.each([
    ["missing", {}],
    ["disabled", { legacy_actor_enabled: false }],
    ["malformed", { legacy_actor_enabled: "true" }],
  ])("defaults to disabled when the health flag is %s", async (_label, body) => {
    const actorTransport = vi.fn();
    const loadLegacyActorUi = vi.fn(async () => ({
      createLegacyActorUiCapability: () => {
        actorTransport();
        return capability;
      },
    }));
    const install = vi.fn();

    await configureLegacyActorUiStartup({
      requestHealth: vi.fn(async () => health(body)),
      loadLegacyActorUi,
      install,
    }, args);

    expect(loadLegacyActorUi).not.toHaveBeenCalled();
    expect(actorTransport).not.toHaveBeenCalled();
    expect(install).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledWith(undefined);
  });

  test.each([
    ["request failure", () => Promise.reject(new Error("offline"))],
    ["non-success response", () => Promise.resolve(health({ legacy_actor_enabled: true }, false))],
    ["invalid JSON", () => Promise.resolve({
      ok: true,
      json: () => Promise.reject(new Error("invalid JSON")),
    })],
  ])("fails closed after a %s", async (_label, requestHealth) => {
    const loadLegacyActorUi = vi.fn();
    const install = vi.fn();

    await expect(configureLegacyActorUiStartup({
      requestHealth,
      loadLegacyActorUi,
      install,
    }, args)).resolves.toBeUndefined();

    expect(loadLegacyActorUi).not.toHaveBeenCalled();
    expect(install).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledWith(undefined);
  });

  test("stays disabled when the enabled legacy module cannot load", async () => {
    const install = vi.fn();

    await expect(configureLegacyActorUiStartup({
      requestHealth: vi.fn(async () => health({ legacy_actor_enabled: true })),
      loadLegacyActorUi: vi.fn(async () => {
        throw new Error("module unavailable");
      }),
      install,
    }, args)).resolves.toBeUndefined();

    expect(install).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledWith(undefined);
  });

  test("loads and installs legacy UI only when health explicitly enables it", async () => {
    const actorTransport = vi.fn();
    const createLegacyActorUiCapability = vi.fn(() => {
      actorTransport();
      return capability;
    });
    const loadLegacyActorUi = vi.fn(async () => ({ createLegacyActorUiCapability }));
    const install = vi.fn();

    await configureLegacyActorUiStartup({
      requestHealth: vi.fn(async () => health({ legacy_actor_enabled: true })),
      loadLegacyActorUi,
      install,
    }, args);

    expect(loadLegacyActorUi).toHaveBeenCalledOnce();
    expect(createLegacyActorUiCapability).toHaveBeenCalledWith(args);
    expect(actorTransport).toHaveBeenCalledOnce();
    expect(install).toHaveBeenNthCalledWith(1, undefined);
    expect(install).toHaveBeenNthCalledWith(2, capability);
  });
});
