const MAX_PNG_BYTES = 10 * 1024 * 1024;
const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type TPngMetadata = Readonly<{
  mimeType: "image/png";
  byteSize: number;
  width: number;
  height: number;
}>;

type TPngValidation =
  | Readonly<{ ok: true; metadata: TPngMetadata }>
  | Readonly<{ ok: false }>;

function base64ByteLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function decodeBase64(value: string, byteLength: number): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = new Uint8Array(byteLength);
  let target = 0;
  for (let index = 0; index < value.length && target < byteLength; index += 4) {
    const a = alphabet.indexOf(value[index] ?? "");
    const b = alphabet.indexOf(value[index + 1] ?? "");
    const c = value[index + 2] === "=" ? 0 : alphabet.indexOf(value[index + 2] ?? "");
    const d = value[index + 3] === "=" ? 0 : alphabet.indexOf(value[index + 3] ?? "");
    if (a < 0 || b < 0 || c < 0 || d < 0) return new Uint8Array();
    bytes[target++] = (a << 2) | (b >> 4);
    if (target < byteLength) bytes[target++] = ((b & 15) << 4) | (c >> 2);
    if (target < byteLength) bytes[target++] = ((c & 3) << 6) | d;
  }
  return bytes;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) * 0x1000000)
    + ((bytes[offset + 1] ?? 0) << 16)
    + ((bytes[offset + 2] ?? 0) << 8)
    + (bytes[offset + 3] ?? 0);
}

/** A bounded structural check for untrusted image results before DOM projection. */
export function fnValidateBoundedPngBase64(args: Readonly<{
  mimeType: unknown;
  data: unknown;
}>): TPngValidation {
  if (args.mimeType !== "image/png" || typeof args.data !== "string") {
    return { ok: false };
  }
  if (
    args.data.length === 0
    || args.data.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(args.data)
  ) return { ok: false };
  const byteSize = base64ByteLength(args.data);
  if (byteSize < 33 || byteSize > MAX_PNG_BYTES) return { ok: false };
  const bytes = decodeBase64(args.data, byteSize);
  if (
    bytes.length !== byteSize
    || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)
    || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR"
  ) return { ok: false };
  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    return { ok: false };
  }
  return {
    ok: true,
    metadata: { mimeType: "image/png", byteSize, width, height },
  };
}
