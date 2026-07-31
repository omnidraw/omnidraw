import { afterEach, describe, expect, it } from 'bun:test';
import { webcrypto } from 'node:crypto';
import { ZWidgetCapsuleHostConfiguration } from '@omnidraw/api/widget/contract';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  WidgetCapsuleHostConfigurationService,
} from '../src/services/WidgetCapsuleHostConfigurationService';
import {
  WidgetCapsuleSigningKeyStore,
} from '../src/services/WidgetCapsuleSigningKeyStore';

const roots: string[] = [];
const MESSAGE = new TextEncoder().encode('capsule-signing-store-test');

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'omnidraw-capsule-keys-'));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

describe('WidgetCapsuleSigningKeyStore', () => {
  it('persists separate preview and release keys and exposes public material only', async () => {
    const directory = await root();
    const first = new WidgetCapsuleSigningKeyStore(directory);
    const [previewKeys, releaseKeys, publicKeys] = await Promise.all([
      first.loadSigningKeys('preview'),
      first.loadSigningKeys('release'),
      first.publicSigningKeys(),
    ]);

    expect(previewKeys).toHaveLength(1);
    expect(releaseKeys).toHaveLength(1);
    expect(previewKeys[0]!.keyId).toBe('omnidraw-preview-v1');
    expect(releaseKeys[0]!.keyId).toBe('omnidraw-release-v1');
    expect(publicKeys.map(({ keyId }) => keyId)).toEqual([
      'omnidraw-preview-v1',
      'omnidraw-release-v1',
    ]);
    expect(JSON.stringify(publicKeys)).not.toContain('private');

    for (const [purpose, publicKey] of [
      ['preview', publicKeys[0]!],
      ['release', publicKeys[1]!],
    ] as const) {
      const signing = (purpose === 'preview' ? previewKeys : releaseKeys)[0]!;
      const verifier = await webcrypto.subtle.importKey(
        'raw',
        Uint8Array.from(Buffer.from(publicKey.publicKeyBase64, 'base64')).buffer,
        'Ed25519',
        false,
        ['verify'],
      );
      const signature = await webcrypto.subtle.sign('Ed25519', signing.privateKey, MESSAGE);
      expect(await webcrypto.subtle.verify('Ed25519', verifier, signature, MESSAGE)).toBe(true);
    }

    const second = new WidgetCapsuleSigningKeyStore(directory);
    const persistedPreview = (await second.loadSigningKeys('preview'))[0]!;
    const persistedSignature = await webcrypto.subtle.sign(
      'Ed25519',
      persistedPreview.privateKey,
      MESSAGE,
    );
    const previewVerifier = await webcrypto.subtle.importKey(
      'raw',
      Uint8Array.from(Buffer.from(publicKeys[0]!.publicKeyBase64, 'base64')).buffer,
      'Ed25519',
      false,
      ['verify'],
    );
    expect(await webcrypto.subtle.verify(
      'Ed25519',
      previewVerifier,
      persistedSignature,
      MESSAGE,
    )).toBe(true);

    const keyFile = join(directory, 'capsule-signing-keys.v1.json');
    expect((await stat(keyFile)).mode & 0o777).toBe(0o600);
    const stored = await readFile(keyFile, 'utf8');
    expect(stored).toContain('privateKeyPkcs8Base64');
    expect(stored).not.toContain('"privateKey"');
  });

  it('fails closed when the persistent signing-key record is malformed', async () => {
    const directory = await root();
    const keyFile = join(directory, 'capsule-signing-keys.v1.json');
    await writeFile(keyFile, '{"format":"wrong"}\n', { mode: 0o600 });
    const store = new WidgetCapsuleSigningKeyStore(directory);

    await expect(store.loadSigningKeys('release')).rejects.toThrow(
      'Capsule signing-key file is invalid.',
    );
  });

  it('rejects a pre-existing signing-key file with broad permissions', async () => {
    const directory = await root();
    const keyFile = join(directory, 'capsule-signing-keys.v1.json');
    await new WidgetCapsuleSigningKeyStore(directory).loadSigningKeys('release');
    await chmod(keyFile, 0o644);

    await expect(
      new WidgetCapsuleSigningKeyStore(directory).loadSigningKeys('release'),
    ).rejects.toThrow('Capsule signing-key file security is invalid.');
  });

  it('rejects a symlinked signing-key record', async () => {
    const directory = await root();
    const keyFile = join(directory, 'capsule-signing-keys.v1.json');
    const movedKeyFile = join(directory, 'moved-capsule-signing-keys.v1.json');
    await new WidgetCapsuleSigningKeyStore(directory).loadSigningKeys('release');
    await rename(keyFile, movedKeyFile);
    await symlink(movedKeyFile, keyFile);

    await expect(
      new WidgetCapsuleSigningKeyStore(directory).loadSigningKeys('release'),
    ).rejects.toThrow('Capsule signing-key file security is invalid.');
  });

  it('rejects broad or symlinked signing-key directories', async () => {
    const parent = await root();
    const broadDirectory = join(parent, 'broad');
    await mkdir(broadDirectory, { mode: 0o755 });
    await expect(
      new WidgetCapsuleSigningKeyStore(broadDirectory).loadSigningKeys('release'),
    ).rejects.toThrow('Capsule signing-key directory security is invalid.');

    const realDirectory = join(parent, 'real');
    const symlinkDirectory = join(parent, 'linked');
    await mkdir(realDirectory, { mode: 0o700 });
    await symlink(realDirectory, symlinkDirectory);
    await expect(
      new WidgetCapsuleSigningKeyStore(symlinkDirectory).loadSigningKeys('release'),
    ).rejects.toThrow('Capsule signing-key directory security is invalid.');
  });

  it('projects a stable strict public-only browser host configuration', async () => {
    const directory = await root();
    const store = new WidgetCapsuleSigningKeyStore(directory);
    const service = new WidgetCapsuleHostConfigurationService(store);
    const first = await service.read();
    const second = await new WidgetCapsuleHostConfigurationService(
      new WidgetCapsuleSigningKeyStore(directory),
    ).read();

    expect(ZWidgetCapsuleHostConfiguration.parse(first)).toEqual(first);
    expect(second).toEqual(first);
    expect(first.generation).toMatch(/^[0-9a-f]{64}$/);
    expect(first.allowedApis).toContain('DOM');
    expect(first.limits).toEqual({});
    expect(first).not.toHaveProperty('targetBase');
    expect(first).not.toHaveProperty('allowedFeatureProfiles');
    expect(JSON.stringify(first)).not.toContain('private');
  });
});
