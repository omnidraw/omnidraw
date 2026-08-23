/** @file Pure serialization for reusing validated widget constructions. */

import type { TWidgetFilesystemConstruction } from './typed';

const BYTES_TAG = '__omnidraw_construction_bytes__';

type TJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly TJsonValue[]
  | Readonly<{ [key: string]: TJsonValue }>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Encode(value: Uint8Array): string {
  let output = '';
  for (let index = 0; index < value.length; index += 3) {
    const a = value[index]!;
    const b = index + 1 < value.length ? value[index + 1]! : 0;
    const c = index + 2 < value.length ? value[index + 2]! : 0;
    output += BASE64_ALPHABET[a >> 2];
    output += BASE64_ALPHABET[((a & 3) << 4) | (b >> 4)];
    output += index + 1 < value.length
      ? BASE64_ALPHABET[((b & 15) << 2) | (c >> 6)]
      : '=';
    output += index + 2 < value.length ? BASE64_ALPHABET[c & 63] : '=';
  }
  return output;
}

function base64Decode(value: string): Uint8Array {
  const alphabetIndex = new Map<string, number>();
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
    alphabetIndex.set(BASE64_ALPHABET[index]!, index);
  }
  const clean = value.replace(/=+$/u, '');
  const output = new Uint8Array(Math.max(0, Math.floor((clean.length * 3) / 4)));
  let outputIndex = 0;
  for (let index = 0; index < clean.length; index += 4) {
    const a = alphabetIndex.get(clean[index]!)!;
    const b = index + 1 < clean.length
      ? alphabetIndex.get(clean[index + 1]!)!
      : 0;
    const c = index + 2 < clean.length
      ? alphabetIndex.get(clean[index + 2]!)!
      : 0;
    const d = index + 3 < clean.length
      ? alphabetIndex.get(clean[index + 3]!)!
      : 0;
    const combined = (a << 18) | (b << 12) | (c << 6) | d;
    output[outputIndex] = (combined >> 16) & 255;
    if (index + 2 < clean.length) output[outputIndex + 1] = (combined >> 8) & 255;
    if (index + 3 < clean.length) output[outputIndex + 2] = combined & 255;
    outputIndex += 3;
  }
  return output.slice(0, outputIndex);
}

function encodeJson(value: unknown): TJsonValue {
  if (value instanceof Uint8Array) {
    return { [BYTES_TAG]: base64Encode(value) };
  }
  if (Array.isArray(value)) return value.map(encodeJson);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      encodeJson(entry),
    ]));
  }
  return value as TJsonValue;
}

function decodeJson(value: TJsonValue): unknown {
  if (Array.isArray(value)) return value.map(decodeJson);
  if (isRecord(value)) {
    const tag = value[BYTES_TAG];
    if (typeof tag === 'string') return base64Decode(tag);
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      decodeJson(entry),
    ]));
  }
  return value;
}

export function fnEncodeWidgetFilesystemConstruction(
  construction: TWidgetFilesystemConstruction,
): string {
  return JSON.stringify(encodeJson(construction));
}

export function fnDecodeWidgetFilesystemConstruction(
  json: string,
): TWidgetFilesystemConstruction {
  const value = decodeJson(JSON.parse(json) as TJsonValue);
  if (!isRecord(value)) throw new TypeError('Invalid cached widget construction.');
  const executableInputDigestSha256 = value.executableInputDigestSha256;
  if (typeof executableInputDigestSha256 !== 'string') {
    throw new TypeError('Cached widget construction is missing its input digest.');
  }
  return value as unknown as TWidgetFilesystemConstruction;
}
