type TArgsProductId = {
  id: string;
};

type TArgsImageResourceId = TArgsProductId & {
  sourceKey?: string;
};

type TArgsElementChildId = TArgsProductId & {
  child: "render" | "inline-text" | "placeholder-frame" | "placeholder-text";
};

type TArgsTransientOwnerId = {
  feature: string;
  sessionId: string;
};

function encodeCodeUnits(value: string): string {
  let encoded = "";
  for (let index = 0; index < value.length; index += 1) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return encoded;
}

function decodeCodeUnits(value: string): string {
  let decoded = "";
  for (let index = 0; index < value.length; index += 4) {
    const codeUnit = Number.parseInt(value.slice(index, index + 4), 16);
    if (!Number.isFinite(codeUnit)) {
      throw new TypeError("Invalid encoded canvas ID.");
    }
    decoded += String.fromCharCode(codeUnit);
  }
  return decoded;
}

function compactHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}-${value.length.toString(36)}`;
}

export function fnEncodeCanvasEngineIdPart(value: string): string {
  try {
    const encoded = encodeURIComponent(value).replace(/[!'()*]/g, (character) => {
      return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
    });
    return `u-${encoded}`;
  } catch {
    return `s-${encodeCodeUnits(value)}`;
  }
}

export function fnDecodeCanvasEngineIdPart(value: string): string {
  if (value.startsWith("u-")) {
    return decodeURIComponent(value.slice(2));
  }
  if (value.startsWith("s-") && value.length % 4 === 2) {
    return decodeCodeUnits(value.slice(2));
  }
  throw new TypeError("Invalid encoded canvas ID.");
}

export function fnCanvasEngineGroupId(args: TArgsProductId): string {
  return `vc:group:${fnEncodeCanvasEngineIdPart(args.id)}`;
}

export function fnCanvasEngineElementId(args: TArgsProductId): string {
  return `vc:element:${fnEncodeCanvasEngineIdPart(args.id)}`;
}

export function fnCanvasEngineElementChildId(args: TArgsElementChildId): string {
  return `${fnCanvasEngineElementId(args)}:${args.child}`;
}

export function fnCanvasEnginePortalId(args: TArgsProductId): string {
  return `vc:portal:${fnEncodeCanvasEngineIdPart(args.id)}`;
}

export function fnCanvasEngineImageResourceId(args: TArgsImageResourceId): string {
  const sourceRevision = args.sourceKey === undefined
    ? ""
    : `:${compactHash(args.sourceKey)}`;
  return `vc:image:${fnEncodeCanvasEngineIdPart(args.id)}${sourceRevision}`;
}

export function fnCanvasEngineTransientOwnerId(args: TArgsTransientOwnerId): string {
  return `vc:transient:${fnEncodeCanvasEngineIdPart(args.feature)}:${fnEncodeCanvasEngineIdPart(args.sessionId)}`;
}
