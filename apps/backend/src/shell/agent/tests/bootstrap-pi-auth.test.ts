import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  bootstrapPiAuth,
  fnOmnidrawPiAgentDirectory,
} from '../bootstrap-pi-auth';

const roots: string[] = [];
const effects = { chmod, copyFile, dirname, lstat, mkdir, stat, unlink };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'omnidraw-pi-auth-bootstrap-'));
  roots.push(root);
  return {
    root,
    source: join(root, 'user', '.pi', 'agent', 'auth.json'),
    destination: join(root, '.omnidraw', 'agent', 'pi', 'agent', 'auth.json'),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('bootstrapPiAuth', () => {
  test('copies Pi credentials once and restricts the destination permissions', async () => {
    const paths = fixture();
    await mkdir(dirname(paths.source), { recursive: true });
    const auth = Buffer.from('{"openai-codex":{"type":"oauth","access":"secret"}}\n');
    writeFileSync(paths.source, auth, { mode: 0o644 });

    const result = await bootstrapPiAuth(effects, {
      sourceAuthPath: paths.source,
      destinationAuthPath: paths.destination,
    });

    expect(result.status).toBe('copied');
    expect(await readFile(paths.destination)).toEqual(auth);
    if (process.platform !== 'win32') {
      expect(statSync(paths.destination).mode & 0o777).toBe(0o600);
      expect(statSync(dirname(paths.destination)).mode & 0o777).toBe(0o700);
    }
  });

  test('preserves an existing Omnidraw auth file without inspecting the source', async () => {
    const paths = fixture();
    await mkdir(dirname(paths.destination), { recursive: true });
    const existing = Buffer.from('{"anthropic":{"type":"api_key","key":"existing"}}\n');
    writeFileSync(paths.destination, existing, { mode: 0o600 });

    const sourceInspectionFailure = Object.assign(
      new Error('source must not be inspected'),
      { code: 'EACCES' },
    );
    const failSourceInspection = (async () => {
      throw sourceInspectionFailure;
    }) as typeof stat;
    const result = await bootstrapPiAuth({ ...effects, stat: failSourceInspection }, {
      sourceAuthPath: paths.source,
      destinationAuthPath: paths.destination,
    });

    expect(result.status).toBe('destination-exists');
    expect(await readFile(paths.destination)).toEqual(existing);
  });

  test('treats an absent Pi auth file as a normal no-op', async () => {
    const paths = fixture();

    const result = await bootstrapPiAuth(effects, {
      sourceAuthPath: paths.source,
      destinationAuthPath: paths.destination,
    });

    expect(result.status).toBe('source-missing');
    expect(await lstat(paths.destination).catch(() => null)).toBeNull();
  });

  test('follows a Pi auth symlink to a regular credential file', async () => {
    const paths = fixture();
    const target = join(paths.root, 'credential-store', 'auth.json');
    await mkdir(dirname(paths.source), { recursive: true });
    await mkdir(dirname(target), { recursive: true });
    writeFileSync(target, '{"openai":{"type":"api_key","key":"secret"}}\n', { mode: 0o600 });
    symlinkSync(target, paths.source);

    const result = await bootstrapPiAuth(effects, {
      sourceAuthPath: paths.source,
      destinationAuthPath: paths.destination,
    });

    expect(result.status).toBe('copied');
    expect(await readFile(paths.destination, 'utf8')).toContain('"openai"');
    expect((await lstat(paths.destination)).isSymbolicLink()).toBe(false);
  });

  test('rejects a non-file source and leaves the destination absent', async () => {
    const paths = fixture();
    await mkdir(paths.source, { recursive: true });

    await expect(bootstrapPiAuth(effects, {
      sourceAuthPath: paths.source,
      destinationAuthPath: paths.destination,
    })).rejects.toThrow('Pi auth bootstrap source is not a regular file');
    expect(await lstat(paths.destination).catch(() => null)).toBeNull();
  });

  test('removes a partial destination when the exclusive copy fails', async () => {
    const paths = fixture();
    await mkdir(dirname(paths.source), { recursive: true });
    writeFileSync(paths.source, '{}\n', { mode: 0o600 });
    const copyFailure = Object.assign(new Error('copy interrupted'), { code: 'EIO' });
    const failingCopy = (async (_source: string, destination: string) => {
      writeFileSync(destination, '{"partial":');
      throw copyFailure;
    }) as typeof copyFile;

    await expect(bootstrapPiAuth({ ...effects, copyFile: failingCopy }, {
      sourceAuthPath: paths.source,
      destinationAuthPath: paths.destination,
    })).rejects.toBe(copyFailure);
    expect(await lstat(paths.destination).catch(() => null)).toBeNull();
  });

  test('removes a copied destination when file permission hardening fails', async () => {
    const paths = fixture();
    await mkdir(dirname(paths.source), { recursive: true });
    writeFileSync(paths.source, '{}\n', { mode: 0o600 });
    const chmodFailure = Object.assign(new Error('chmod denied'), { code: 'EACCES' });
    const failingChmod = (async (path: string, mode: number) => {
      if (path === paths.destination) throw chmodFailure;
      await chmod(path, mode);
    }) as typeof chmod;

    await expect(bootstrapPiAuth({ ...effects, chmod: failingChmod }, {
      sourceAuthPath: paths.source,
      destinationAuthPath: paths.destination,
    })).rejects.toBe(chmodFailure);
    expect(await lstat(paths.destination).catch(() => null)).toBeNull();
  });

  test('uses the same private Pi directory as AgentService', () => {
    expect(fnOmnidrawPiAgentDirectory(join, '/home/user/.omnidraw/agent')).toBe(
      '/home/user/.omnidraw/agent/pi/agent',
    );
  });
});
