import type { TVibecanvasActorJson } from "./actor";

type TVibecanvasAddonActorConfig = TVibecanvasActorJson & {
  /** Defaults to ./actor/functions.ts. */
  functions?: string;
};

type TVibecanvasAddonWidgetConfig = {
  /** Defaults to ./widget. main.ts and main.css are conventional defaults. */
  sourceDir?: string;
};

type TVibecanvasAddonFrontendConfig = {
  element?: {
    initialPayload?: Record<string, unknown>;
    actor?: {
      uiProps?: Record<string, unknown>;
    };
  };
};

type TVibecanvasWidgetAddonConfig = {
  id: string;
  slug: string;
  name: string;
  version?: string;
  description?: string;
  actor?: TVibecanvasAddonActorConfig;
  widget?: TVibecanvasAddonWidgetConfig;
  frontend?: TVibecanvasAddonFrontendConfig;
};

type TVibecanvasConfig = TVibecanvasWidgetAddonConfig;

function defineVibecanvasConfig<TConfig extends TVibecanvasConfig>(config: TConfig): TConfig {
  return config;
}

function defineWidgetAddon<TConfig extends TVibecanvasWidgetAddonConfig>(config: TConfig): TConfig {
  return config;
}

type TVibecanvasWidgetConfig = TVibecanvasWidgetAddonConfig;

type TVibecanvasWidgetBundleConfig = TVibecanvasWidgetAddonConfig;

export { defineVibecanvasConfig, defineWidgetAddon };
export type {
  TVibecanvasAddonActorConfig,
  TVibecanvasAddonFrontendConfig,
  TVibecanvasAddonWidgetConfig,
  TVibecanvasConfig,
  TVibecanvasWidgetAddonConfig,
  TVibecanvasWidgetBundleConfig,
  TVibecanvasWidgetConfig,
};
