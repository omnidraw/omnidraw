import type { TVibecanvasDefinedActor } from "./actor";

type TVibecanvasWidgetBundleConfig = {
  slug: string;
  name: string;
  version: string;
  source: Record<string, string>;
  defaultSize?: {
    width: number;
    height: number;
  };
  uiManifest?: Record<string, unknown>;
};

type TVibecanvasConfig = {
  actors?: TVibecanvasDefinedActor[];
  widgets?: TVibecanvasWidgetBundleConfig[];
};

function defineVibecanvasConfig(config: TVibecanvasConfig) {
  return config;
}

type TVibecanvasWidgetConfig = TVibecanvasWidgetBundleConfig;

export { defineVibecanvasConfig };
export type { TVibecanvasConfig, TVibecanvasWidgetBundleConfig, TVibecanvasWidgetConfig };
