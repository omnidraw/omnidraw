import type { TVibecanvasActorJson } from "./actor";

type TVibecanvasWidgetToolConfig = {
  id: string;
  label: string;
  icon?: string;
  group?: string;
  priority?: number;
  shortcuts?: string[];
  behavior?: {
    type: "mode";
    mode: "draw-create" | "click-create";
  };
  render?: {
    defaultWidth?: number;
    defaultHeight?: number;
    minWidth?: number;
    minHeight?: number;
    title?: string;
  };
};

type TVibecanvasWidgetAddonConfig = {
  id: string;
  slug: string;
  name: string;
  version?: string;
  description?: string;
  actor?: {
    definition: string;
    functions: string;
  };
  widget: {
    runtime: "arrowjs-sandbox";
    sourceDir: string;
    entry: "main.ts" | "main.js";
    stylesheet?: "main.css";
    defaultSize?: {
      width: number;
      height: number;
    };
  };
  frontend?: {
    element?: {
      kind?: string;
      dataType?: "widget" | "ui-widget";
      initialPayload?: Record<string, unknown>;
      actor?: {
        actorSlug: string;
        uiProps?: Record<string, unknown>;
      };
    };
    tool?: TVibecanvasWidgetToolConfig;
  };
  messages?: {
    inputs?: string[];
    outputs?: string[];
    connectionRouting?: {
      outputPrefix?: string;
      targetInputPrefix?: string;
    };
  };
};

type TVibecanvasConfig = {
  actor?: TVibecanvasActorJson;
  addon?: TVibecanvasWidgetAddonConfig;
};

function defineVibecanvasConfig(config: TVibecanvasConfig) {
  return config;
}

function defineWidgetAddon<TConfig extends TVibecanvasWidgetAddonConfig>(config: TConfig): TConfig {
  return config;
}

type TVibecanvasWidgetConfig = TVibecanvasWidgetAddonConfig;

type TVibecanvasWidgetBundleConfig = TVibecanvasWidgetAddonConfig;

export { defineVibecanvasConfig, defineWidgetAddon };
export type { TVibecanvasConfig, TVibecanvasWidgetAddonConfig, TVibecanvasWidgetBundleConfig, TVibecanvasWidgetConfig, TVibecanvasWidgetToolConfig };
