import type {
  TColor,
  TPaint,
} from "@vibecanvas/canvas-engine";
import type { TCanvasProjectionTheme } from "../typed";
import { CANVAS_ENGINE_COLORS } from "../CONSTANTS";

type TArgsColor = {
  value: string | undefined;
};

type TArgsResolvedColor = TArgsColor & {
  theme: TCanvasProjectionTheme;
  fallback?: string | TColor;
};

type TArgsPaint = {
  color: TColor;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function color(red: number, green: number, blue: number, alpha = 1): TColor {
  return {
    space: "srgb",
    r: clamp(red, 0, 255) / 255,
    g: clamp(green, 0, 255) / 255,
    b: clamp(blue, 0, 255) / 255,
    a: clamp(alpha, 0, 1),
  };
}

function parseHex(value: string): TColor | null {
  const hex = value.slice(1);
  if (![3, 4, 6, 8].includes(hex.length) || !/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }

  if (hex.length === 3 || hex.length === 4) {
    return color(
      Number.parseInt(hex[0]! + hex[0]!, 16),
      Number.parseInt(hex[1]! + hex[1]!, 16),
      Number.parseInt(hex[2]! + hex[2]!, 16),
      hex.length === 4 ? Number.parseInt(hex[3]! + hex[3]!, 16) / 255 : 1,
    );
  }

  return color(
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
    hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
  );
}

function parseChannel(value: string): number | null {
  const trimmed = value.trim();
  const percentage = trimmed.endsWith("%");
  const numeric = Number.parseFloat(percentage ? trimmed.slice(0, -1) : trimmed);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return percentage ? clamp(numeric, 0, 100) * 2.55 : clamp(numeric, 0, 255);
}

function parseAlpha(value: string | undefined): number | null {
  if (value === undefined) {
    return 1;
  }
  const trimmed = value.trim();
  const percentage = trimmed.endsWith("%");
  const numeric = Number.parseFloat(percentage ? trimmed.slice(0, -1) : trimmed);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return percentage ? clamp(numeric, 0, 100) / 100 : clamp(numeric, 0, 1);
}

function parseFunctionalColor(value: string): TColor | null {
  const match = value.match(/^rgba?\((.*)\)$/i);
  if (!match?.[1]) {
    return null;
  }

  const functionName = value.slice(0, value.indexOf("(")).toLowerCase();
  const body = match[1].trim();
  let channels: string[];
  let alpha: string | undefined;

  if (body.includes(",")) {
    const components = body.split(",").map((part) => part.trim());
    channels = components.slice(0, 3);
    alpha = components[3];
    if (components.length !== (functionName === "rgba" ? 4 : 3)) {
      return null;
    }
  } else {
    const [channelPart, alphaPart] = body.split("/").map((part) => part.trim());
    channels = (channelPart ?? "").split(/\s+/).filter(Boolean);
    alpha = alphaPart;
    if (channels.length !== 3 || body.split("/").length > 2) {
      return null;
    }
  }

  const red = parseChannel(channels[0] ?? "");
  const green = parseChannel(channels[1] ?? "");
  const blue = parseChannel(channels[2] ?? "");
  const resolvedAlpha = parseAlpha(alpha);
  if (red === null || green === null || blue === null || resolvedAlpha === null) {
    return null;
  }
  return color(red, green, blue, resolvedAlpha);
}

function cloneColor(value: TColor): TColor {
  return { ...value };
}

export function fnParseCssColor(args: TArgsColor): TColor | null {
  const value = args.value?.trim().toLowerCase();
  if (!value) {
    return null;
  }
  if (value === "transparent") {
    return cloneColor(CANVAS_ENGINE_COLORS.transparent);
  }
  if (value === "black") {
    return cloneColor(CANVAS_ENGINE_COLORS.black);
  }
  if (value === "white") {
    return cloneColor(CANVAS_ENGINE_COLORS.white);
  }
  if (value.startsWith("#")) {
    return parseHex(value);
  }
  return parseFunctionalColor(value);
}

export function fnResolveCanvasProjectionColor(args: TArgsResolvedColor): TColor {
  const resolvedValue = args.value?.startsWith("@")
    ? args.theme.colorTokens[args.value]
    : args.value;
  const parsed = fnParseCssColor({ value: resolvedValue });
  if (parsed) {
    return parsed;
  }
  if (typeof args.fallback === "string") {
    return fnParseCssColor({ value: args.fallback }) ?? cloneColor(CANVAS_ENGINE_COLORS.black);
  }
  return args.fallback
    ? cloneColor(args.fallback)
    : cloneColor(CANVAS_ENGINE_COLORS.black);
}

export function fnCanvasSolidPaint(args: TArgsPaint): TPaint {
  return {
    type: "solid",
    color: cloneColor(args.color),
  };
}
