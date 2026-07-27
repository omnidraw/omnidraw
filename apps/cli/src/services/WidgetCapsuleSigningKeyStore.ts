import type { CapsuleArtifactSigningKey } from '@vibecanvas/capsule-vibecanvas/builder';
import type { TWidgetCapsulePublicSigningKey } from '@vibecanvas/widget-contract';
import { webcrypto, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { link, lstat, mkdir, open, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  WIDGET_CAPSULE_PREVIEW_SIGNING_KEY_ID,
  WIDGET_CAPSULE_RELEASE_SIGNING_KEY_ID,
} from './CONSTANTS';

const KEY_FILE_FORMAT = 'vibecanvas.capsule-signing-keys.v1';
const KEY_FILE_NAME = 'capsule-signing-keys.v1.json';
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PAIR_CHECK_BYTES = new TextEncoder().encode('vibecanvas-capsule-signing-key-pair-v1');
const PAIR_CHECK_BUFFER = PAIR_CHECK_BYTES.buffer.slice(
  PAIR_CHECK_BYTES.byteOffset,
  PAIR_CHECK_BYTES.byteOffset + PAIR_CHECK_BYTES.byteLength,
) as ArrayBuffer;

type TStoredKey = Readonly<{
  keyId: string;
  privateKeyPkcs8Base64: string;
  publicKeyRawBase64: string;
}>;

type TStoredKeyFile = Readonly<{
  format: typeof KEY_FILE_FORMAT;
  preview: TStoredKey;
  release: TStoredKey;
}>;

type TLoadedKey = Readonly<{
  signing: CapsuleArtifactSigningKey;
  publicKey: TWidgetCapsulePublicSigningKey;
}>;

type TLoadedKeys = Readonly<{
  preview: TLoadedKey;
  release: TLoadedKey;
}>;

function exactObjectKeys(
  value: object,
  expected: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length
    && expected.every((key) => keys.includes(key));
}

function isStoredKey(value: unknown, keyId: string): value is TStoredKey {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && exactObjectKeys(value, [
      'keyId',
      'privateKeyPkcs8Base64',
      'publicKeyRawBase64',
    ])
    && (value as TStoredKey).keyId === keyId
    && typeof (value as TStoredKey).privateKeyPkcs8Base64 === 'string'
    && BASE64_PATTERN.test((value as TStoredKey).privateKeyPkcs8Base64)
    && typeof (value as TStoredKey).publicKeyRawBase64 === 'string'
    && BASE64_PATTERN.test((value as TStoredKey).publicKeyRawBase64);
}

function parseStoredKeyFile(value: string): TStoredKeyFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Capsule signing-key file is invalid.');
  }
  if (
    typeof parsed !== 'object'
    || parsed === null
    || Array.isArray(parsed)
    || !exactObjectKeys(parsed, ['format', 'preview', 'release'])
    || (parsed as TStoredKeyFile).format !== KEY_FILE_FORMAT
    || !isStoredKey(
      (parsed as TStoredKeyFile).preview,
      WIDGET_CAPSULE_PREVIEW_SIGNING_KEY_ID,
    )
    || !isStoredKey(
      (parsed as TStoredKeyFile).release,
      WIDGET_CAPSULE_RELEASE_SIGNING_KEY_ID,
    )
  ) {
    throw new Error('Capsule signing-key file is invalid.');
  }
  return Object.freeze({
    format: KEY_FILE_FORMAT,
    preview: Object.freeze({ ...(parsed as TStoredKeyFile).preview }),
    release: Object.freeze({ ...(parsed as TStoredKeyFile).release }),
  });
}

function decodeBase64(value: string): ArrayBuffer {
  const bytes = Uint8Array.from(Buffer.from(value, 'base64'));
  if (Buffer.from(bytes).toString('base64') !== value) {
    throw new Error('Capsule signing-key file contains non-canonical base64.');
  }
  return bytes.buffer;
}

async function generateStoredKey(keyId: string): Promise<TStoredKey> {
  const pair = await webcrypto.subtle.generateKey(
    'Ed25519',
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const [privateKey, publicKey] = await Promise.all([
    webcrypto.subtle.exportKey('pkcs8', pair.privateKey),
    webcrypto.subtle.exportKey('raw', pair.publicKey),
  ]);
  return Object.freeze({
    keyId,
    privateKeyPkcs8Base64: Buffer.from(privateKey).toString('base64'),
    publicKeyRawBase64: Buffer.from(publicKey).toString('base64'),
  });
}

async function generateStoredKeyFile(): Promise<TStoredKeyFile> {
  const [preview, release] = await Promise.all([
    generateStoredKey(WIDGET_CAPSULE_PREVIEW_SIGNING_KEY_ID),
    generateStoredKey(WIDGET_CAPSULE_RELEASE_SIGNING_KEY_ID),
  ]);
  return Object.freeze({ format: KEY_FILE_FORMAT, preview, release });
}

async function importStoredKey(value: TStoredKey): Promise<TLoadedKey> {
  const [privateKey, publicKey] = await Promise.all([
    webcrypto.subtle.importKey(
      'pkcs8',
      decodeBase64(value.privateKeyPkcs8Base64),
      'Ed25519',
      false,
      ['sign'],
    ),
    webcrypto.subtle.importKey(
      'raw',
      decodeBase64(value.publicKeyRawBase64),
      'Ed25519',
      false,
      ['verify'],
    ),
  ]);
  const signature = await webcrypto.subtle.sign('Ed25519', privateKey, PAIR_CHECK_BUFFER);
  if (!await webcrypto.subtle.verify('Ed25519', publicKey, signature, PAIR_CHECK_BUFFER)) {
    throw new Error('Capsule signing-key file contains a mismatched key pair.');
  }
  return Object.freeze({
    signing: Object.freeze({
      keyId: value.keyId,
      privateKey: privateKey as CryptoKey,
    }),
    publicKey: Object.freeze({
      keyId: value.keyId,
      algorithm: 'Ed25519' as const,
      format: 'raw' as const,
      publicKeyBase64: value.publicKeyRawBase64,
    }),
  });
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'EEXIST';
}

function currentEffectiveUserId(): number | undefined {
  return typeof process.geteuid === 'function' ? process.geteuid() : undefined;
}

async function assertSecureKeyDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  const effectiveUserId = currentEffectiveUserId();
  if (
    metadata.isSymbolicLink()
    || !metadata.isDirectory()
    || (metadata.mode & 0o777) !== 0o700
    || (effectiveUserId !== undefined && metadata.uid !== effectiveUserId)
  ) {
    throw new Error('Capsule signing-key directory security is invalid.');
  }
}

async function readSecureKeyFile(path: string): Promise<string> {
  let handle;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
  } catch (error) {
    if (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && (error.code === 'ELOOP' || error.code === 'EMLINK')
    ) {
      throw new Error('Capsule signing-key file security is invalid.');
    }
    throw error;
  }
  try {
    const metadata = await handle.stat();
    const effectiveUserId = currentEffectiveUserId();
    if (
      !metadata.isFile()
      || metadata.nlink !== 1
      || (metadata.mode & 0o777) !== 0o600
      || (effectiveUserId !== undefined && metadata.uid !== effectiveUserId)
    ) {
      throw new Error('Capsule signing-key file security is invalid.');
    }
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

/**
 * Deployment-local signing authority. Private keys remain in one mode-0600
 * server file; only the public-key projection may cross the API boundary.
 */
export class WidgetCapsuleSigningKeyStore {
  readonly #directory: string;
  readonly #path: string;
  #loaded: Promise<TLoadedKeys> | undefined;

  constructor(root: string) {
    this.#directory = root;
    this.#path = join(root, KEY_FILE_NAME);
  }

  loadSigningKeys(
    purpose: 'preview' | 'release',
  ): Promise<readonly CapsuleArtifactSigningKey[]> {
    return this.#load().then((keys) => Object.freeze([keys[purpose].signing]));
  }

  publicSigningKeys(): Promise<readonly TWidgetCapsulePublicSigningKey[]> {
    return this.#load().then((keys) => Object.freeze([
      keys.preview.publicKey,
      keys.release.publicKey,
    ]));
  }

  async #load(): Promise<TLoadedKeys> {
    this.#loaded ??= this.#readOrCreate();
    return await this.#loaded;
  }

  async #readOrCreate(): Promise<TLoadedKeys> {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await assertSecureKeyDirectory(this.#directory);
    let stored: TStoredKeyFile;
    try {
      stored = parseStoredKeyFile(await readSecureKeyFile(this.#path));
    } catch (error) {
      if (
        typeof error !== 'object'
        || error === null
        || !('code' in error)
        || error.code !== 'ENOENT'
      ) throw error;
      const candidate = await generateStoredKeyFile();
      const temporaryPath = `${this.#path}.${randomUUID()}.tmp`;
      try {
        await writeFile(
          temporaryPath,
          `${JSON.stringify(candidate)}\n`,
          { flag: 'wx', mode: 0o600 },
        );
        try {
          await link(temporaryPath, this.#path);
        } catch (linkError) {
          if (!isAlreadyExists(linkError)) throw linkError;
        }
      } finally {
        await unlink(temporaryPath).catch(() => undefined);
      }
      stored = parseStoredKeyFile(await readSecureKeyFile(this.#path));
    }
    const [preview, release] = await Promise.all([
      importStoredKey(stored.preview),
      importStoredKey(stored.release),
    ]);
    return Object.freeze({ preview, release });
  }
}
