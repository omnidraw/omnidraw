import type { TLegacyActorUiCapability } from "@vibecanvas/ui-ai-chat";
import type { TCreateLegacyActorUiCapabilityArgs } from "@vibecanvas/ui-actor-legacy";

type TLegacyActorUiHealthResponse = Readonly<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

type TLegacyActorUiModule = Readonly<{
  createLegacyActorUiCapability(
    args: TCreateLegacyActorUiCapabilityArgs,
  ): TLegacyActorUiCapability;
}>;

export type TLegacyActorUiStartupPortal = Readonly<{
  requestHealth(): Promise<TLegacyActorUiHealthResponse>;
  loadLegacyActorUi(): Promise<TLegacyActorUiModule>;
  install(capability: TLegacyActorUiCapability | undefined): void;
}>;

function isLegacyActorEnabled(value: unknown): boolean {
  return typeof value === "object"
    && value !== null
    && "legacy_actor_enabled" in value
    && value.legacy_actor_enabled === true;
}

export async function configureLegacyActorUiStartup(
  portal: TLegacyActorUiStartupPortal,
  args: TCreateLegacyActorUiCapabilityArgs,
): Promise<void> {
  portal.install(undefined);

  try {
    const response = await portal.requestHealth();
    if (!response.ok || !isLegacyActorEnabled(await response.json())) return;

    const legacyActorUi = await portal.loadLegacyActorUi();
    portal.install(legacyActorUi.createLegacyActorUiCapability(args));
  } catch {
    // Health, module, and construction failures all leave legacy UI disabled.
  }
}
