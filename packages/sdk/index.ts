export type TVibecanvasWidgetSource =
  | {
    "main.ts": string;
    "main.css"?: string;
    [path: string]: string | undefined;
  }
  | {
    "main.js": string;
    "main.css"?: string;
    [path: string]: string | undefined;
  };

export type TVibecanvasWidgetSandboxConfig = {
  arrowjs: TVibecanvasWidgetSource;
};

export type TVibecanvasWidgetElement = {
  id: string;
  x: number;
  y: number;
  rotation: number;
  zIndex: string;
  parentGroupId: string | null;
  bindings: unknown[];
  locked: boolean;
  createdAt: number;
  updatedAt: number;
  data: {
    type: "widget";
    kind: string;
    expanded?: boolean;
    window?: "contained" | "fullscreen" | string;
    w: number;
    h: number;
    payload?: Record<string, unknown>;
  } | Record<string, unknown>;
  style: Record<string, unknown>;
};

export type TVibecanvasWidgetRenderArgs = {
  root: HTMLDivElement;
  element: TVibecanvasWidgetElement;
};

export type TVibecanvasWidgetRenderCleanup = () => void;

export type TVibecanvasWidgetToolConfig = {
  group?: string;
  icon?: string;
  label?: string;
  priority?: number;
  shortcuts?: string[];
};

export type TVibecanvasWidgetConfig = {
  id: string;
  tool?: TVibecanvasWidgetToolConfig;
  initialPayload?: Record<string, unknown>;
  renderDom?: (args: TVibecanvasWidgetRenderArgs) => TVibecanvasWidgetRenderCleanup | void;
  sandbox?: TVibecanvasWidgetSandboxConfig;
};

export type TVibecanvasWidgetManifest = {
  schemaVersion: 1;
  id: string;
  label: string;
  permissions: string[];
  defaultSize?: {
    width: number;
    height: number;
  };
  source: Record<string, string>;
};

export type TVibecanvasArrowJsSource = TVibecanvasWidgetSource;
