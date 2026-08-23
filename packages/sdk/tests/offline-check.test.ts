import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const cliPath = join(repositoryRoot, 'packages/sdk/dist/cli.js');

async function storedPackage(prefix: string, relativePath: string): Promise<string> {
  const store = join(repositoryRoot, 'node_modules/.bun');
  const name = (await readdir(store)).find((entry) => entry.startsWith(prefix));
  if (name === undefined) throw new Error(`Missing Bun store package ${prefix}.`);
  return join(store, name, 'node_modules', relativePath);
}

function manifest(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
    schemaVersion: 1,
    name: 'Offline Check Fixture',
    slug: 'offline-check-fixture',
    description: 'Exercises the public offline checker.',
    tool: { label: 'Offline Check Fixture', group: null, priority: 0 },
    ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
    resources: [{
      slot: 'store',
      resourceId: 'syntactically-valid-but-not-installed',
      kind: 'kv',
      effect: 'read',
      required: true,
    }],
    ...overrides,
  };
}

async function createProject(root: string): Promise<void> {
  await mkdir(join(root, 'ui'), { recursive: true });
  await mkdir(join(root, 'node_modules'), { recursive: true });
  await symlink(
    await storedPackage('typescript@5.9.3', 'typescript'),
    join(root, 'node_modules/typescript'),
    'dir',
  );
  await writeFile(join(root, 'package.json'), `${JSON.stringify({
    name: 'offline-check-fixture',
    private: true,
    type: 'module',
    scripts: {
      check: 'omnidraw-widget check .',
      build: 'omnidraw-widget build .',
    },
    dependencies: { '@omnidraw/sdk': '0.9.1' },
    devDependencies: { typescript: '5.9.3' },
  }, null, 2)}\n`);
  await writeFile(join(root, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      lib: ['ES2022', 'DOM'],
    },
    include: ['ui/**/*.ts', 'server/**/*.ts'],
  }, null, 2)}\n`);
  await writeFile(join(root, 'omnidraw.json'), `${JSON.stringify(manifest(), null, 2)}\n`);
  await writeFile(join(root, 'ui/main.ts'), [
    'const node = document.createElement("div");',
    'node.textContent = "offline check ready";',
    'document.body.append(node);',
    '',
  ].join('\n'));
  await writeFile(join(root, 'dist-sentinel'), 'must remain unchanged\n');
}

async function runCheck(
  root: string,
  args: readonly string[] = ['check', '.', '--json'],
  environment: Readonly<Record<string, string>> = {},
): Promise<Readonly<{ exitCode: number; stdout: string; stderr: string }>> {
  const child = Bun.spawn(['node', cliPath, ...args], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HTTP_PROXY: 'http://127.0.0.1:1',
      HTTPS_PROXY: 'http://127.0.0.1:1',
      NO_PROXY: '',
      ...environment,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

function digest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('omnidraw-widget offline check', () => {
  test('is deterministic, read-only, host-free, database-free, and explicit about limitations', async () => {
    const base = await mkdtemp('/tmp/omnidraw-offline-check-');
    const root = join(base, 'project');
    const fakeHome = join(base, 'fake-home');
    await mkdir(root);
    await mkdir(fakeHome);
    const fakeDatabase = join(fakeHome, 'main.db');
    await writeFile(fakeDatabase, 'must-not-be-opened\n');
    await createProject(root);
    const beforeDatabase = await readFile(fakeDatabase);
    const beforeDatabaseStat = await stat(fakeDatabase);
    const beforeSource = await readFile(join(root, 'ui/main.ts'));
    const beforeManifest = await readFile(join(root, 'omnidraw.json'));
    const beforeSentinel = await readFile(join(root, 'dist-sentinel'));
    const connectionTrap = join(base, 'connection-trap.cjs');
    const connectionEvidence = join(base, 'connection-attempted');
    await writeFile(connectionTrap, [
      'const fs = require("node:fs");',
      'const trap = () => {',
      '  fs.appendFileSync(process.env.OFFLINE_CONNECTION_EVIDENCE, "attempted\\n");',
      '  throw new Error("offline check attempted a network connection");',
      '};',
      'const net = require("node:net");',
      'net.connect = trap;',
      'net.createConnection = trap;',
      'net.Socket.prototype.connect = trap;',
      'const http = require("node:http");',
      'http.request = trap;',
      'http.get = trap;',
      'const https = require("node:https");',
      'https.request = trap;',
      'https.get = trap;',
      'globalThis.fetch = trap;',
      '',
    ].join('\n'));
    let connections = 0;
    const listener = createServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    let listening = false;
    await new Promise<void>((resolveListen) => {
      listener.once('error', () => resolveListen());
      listener.listen(0, '127.0.0.1', () => {
        listening = true;
        resolveListen();
      });
    });
    const address = listening ? listener.address() : null;
    const port = address !== null && typeof address !== 'string' ? address.port : 9;
    try {
      const environment = {
        OMNIDRAW_HOME: fakeHome,
        OMNIDRAW_HOST_TOKEN: 'must-not-be-echoed',
        OMNIDRAW_SERVER_URL: `http://127.0.0.1:${port}`,
        DATABASE_URL: `file:${fakeDatabase}`,
        NODE_OPTIONS: `--require=${connectionTrap}`,
        OFFLINE_CONNECTION_EVIDENCE: connectionEvidence,
      };
      const first = await runCheck(root, undefined, environment);
      const second = await runCheck(root, undefined, environment);
      expect(first).toEqual(second);
      expect(first).toMatchObject({ exitCode: 0, stderr: '' });
      const report = JSON.parse(first.stdout);
      expect(report).toEqual({
        schemaVersion: 1,
        ok: true,
        scope: 'offline-project',
        checks: [],
        limitations: ['resource-existence-not-checked', 'preview-runtime-not-checked'],
        truncated: false,
      });
      expect(first.stdout).not.toContain(base);
      expect(first.stdout).not.toContain('must-not-be-echoed');
      expect(connections).toBe(0);
      expect(await lstat(connectionEvidence).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error))).toBeNull();
      expect(digest(await readFile(fakeDatabase))).toBe(digest(beforeDatabase));
      expect((await stat(fakeDatabase)).mtimeMs).toBe(beforeDatabaseStat.mtimeMs);
      expect(await readFile(join(root, 'ui/main.ts'))).toEqual(beforeSource);
      expect(await readFile(join(root, 'omnidraw.json'))).toEqual(beforeManifest);
      expect(await readFile(join(root, 'dist-sentinel'))).toEqual(beforeSentinel);
      expect(await lstat(join(root, 'dist')).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error))).toBeNull();
    } finally {
      if (listening) {
        await new Promise<void>((resolveClose, reject) => listener.close((error) => error === undefined ? resolveClose() : reject(error)));
      }
      await rm(base, { recursive: true, force: true });
    }
  }, 30_000);

  test('returns stable distinct validation and CLI failures with widget-relative locations', async () => {
    const base = await mkdtemp('/tmp/omnidraw-offline-invalid-');
    const root = join(base, 'project');
    await mkdir(root);
    try {
      await createProject(root);
      await writeFile(join(root, 'omnidraw.json'), `${JSON.stringify(manifest({
        resources: [{ slot: 'store', resourceId: 'bad/id', kind: 'kv', effect: 'read', required: true }],
      }))}\n`);
      const badId = await runCheck(root);
      expect(badId).toMatchObject({ exitCode: 3, stderr: '' });
      expect(JSON.parse(badId.stdout).checks).toContainEqual(expect.objectContaining({
        phase: 'manifest', code: 'RESOURCE_ID_INVALID',
        location: { file: 'widget://omnidraw.json' },
      }));

      await writeFile(join(root, 'omnidraw.json'), `${JSON.stringify(manifest())}\n`);
      await writeFile(join(root, 'ui/main.ts'), 'const value: string = 1;\n');
      const typeError = await runCheck(root);
      expect(JSON.parse(typeError.stdout).checks).toContainEqual(expect.objectContaining({
        phase: 'typescript', code: 'TS2322',
        location: expect.objectContaining({ file: 'widget://ui/main.ts', line: 1 }),
      }));
      expect(typeError.stdout).not.toContain(base);

      await writeFile(join(root, 'ui/main.ts'), [
        'window.addEventListener("pagehide", () => {',
        '  throw new Error("private authored value");',
        '}, { once: true });',
        '',
      ].join('\n'));
      const unsupportedDomEvent = await runCheck(root);
      expect(JSON.parse(unsupportedDomEvent.stdout).checks).toContainEqual(expect.objectContaining({
        phase: 'policy',
        code: 'SOURCE_DOM_EVENT_UNSUPPORTED',
        summary: 'window.addEventListener("pagehide", ...) is unsupported by this widget API profile. Remove it and rely on host disposal for cleanup.',
        location: { file: 'widget://ui/main.ts', line: 1, column: 1 },
      }));
      expect(unsupportedDomEvent.stdout).not.toContain('private authored value');

      await writeFile(join(root, 'omnidraw.json'), `${JSON.stringify(manifest({
        ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM', 'WEBGL'] },
      }))}\n`);
      const webglPagehide = await runCheck(root);
      expect(webglPagehide).toMatchObject({ exitCode: 0, stderr: '' });
      expect(JSON.parse(webglPagehide.stdout).checks).not.toContainEqual(expect.objectContaining({
        code: 'SOURCE_DOM_EVENT_UNSUPPORTED',
      }));

      await writeFile(join(root, 'omnidraw.json'), `${JSON.stringify(manifest({
        ui: { runtime: 'capsule', entry: 'ui/missing.ts', apis: ['DOM'] },
      }))}\n`);
      const missing = await runCheck(root);
      expect(JSON.parse(missing.stdout).checks).toContainEqual(expect.objectContaining({
        phase: 'source', code: 'UI_ENTRY_MISSING',
        location: { file: 'widget://ui/missing.ts' },
      }));

      await mkdir(join(root, 'server'), { recursive: true });
      await writeFile(join(root, 'server/main.ts'), [
        'export const run = defineServerFunction({',
        '  effect: "fx", input: schema, output: schema,',
        '  resources: { missingSlot: "read" },',
        '}, async () => ({}));',
        '',
      ].join('\n'));
      await writeFile(join(root, 'omnidraw.json'), `${JSON.stringify(manifest({
        server: { entry: 'server/main.ts' },
      }))}\n`);
      const descriptor = await runCheck(root);
      expect(descriptor).toMatchObject({ exitCode: 3, stderr: '' });
      expect(JSON.parse(descriptor.stdout).checks).toContainEqual(expect.objectContaining({
        phase: 'functions', code: 'FUNCTION_RESOURCE_SLOT_UNDECLARED',
        location: expect.objectContaining({ file: 'widget://server/main.ts' }),
      }));

      await mkdir(join(root, 'backend'), { recursive: true });
      await writeFile(join(root, 'backend/functions.ts'), [
        'import { defineServerFunction } from "@omnidraw/sdk/server";',
        'const schema = {};',
        'export const run = defineServerFunction({',
        '  effect: "fn", input: schema, output: schema,',
        '}, async () => ({}));',
        '',
      ].join('\n'));
      await writeFile(join(root, 'omnidraw.json'), `${JSON.stringify(manifest({
        server: { entry: 'backend/functions.ts' },
      }))}\n`);
      const customServerEntry = await runCheck(root);
      expect(JSON.parse(customServerEntry.stdout).checks).not.toContainEqual(expect.objectContaining({
        phase: 'policy',
        code: 'SOURCE_IMPORT_FORBIDDEN',
        location: expect.objectContaining({ file: 'widget://backend/functions.ts' }),
      }));

      await writeFile(join(root, 'backend/functions.ts'), [
        'import { defineServerFunction } from "@omnidraw/sdk/server";',
        'import { Type } from "typebox";',
        'void Type;',
        'const schema = {};',
        'export const run = defineServerFunction({ effect: "fn", input: schema, output: schema }, async () => ({}));',
        '',
      ].join('\n'));
      const vettedSchemaLibrary = await runCheck(root);
      expect(JSON.parse(vettedSchemaLibrary.stdout).checks).not.toContainEqual(expect.objectContaining({
        phase: 'policy',
        code: 'SOURCE_IMPORT_FORBIDDEN',
        location: expect.objectContaining({ file: 'widget://backend/functions.ts', line: 2 }),
      }));

      await writeFile(join(root, 'backend/functions.ts'), [
        'import { defineServerFunction } from "@omnidraw/sdk/server";',
        'import { z } from "zod";',
        'void z;',
        'const schema = {};',
        'export const run = defineServerFunction({ effect: "fn", input: schema, output: schema }, async () => ({}));',
        '',
      ].join('\n'));
      const unqualifiedSchemaLibrary = await runCheck(root);
      expect(JSON.parse(unqualifiedSchemaLibrary.stdout).checks).toContainEqual(expect.objectContaining({
        phase: 'policy',
        code: 'SOURCE_IMPORT_FORBIDDEN',
        location: expect.objectContaining({ file: 'widget://backend/functions.ts', line: 2 }),
      }));

      await writeFile(join(root, 'backend/functions.ts'), [
        'import { defineServerFunction } from "@omnidraw/sdk/server";',
        'const schema = {};',
        'const generated = eval("1");',
        'void generated;',
        'export const run = defineServerFunction({',
        '  effect: "fn", input: schema, output: schema,',
        '}, async () => ({}));',
        '',
      ].join('\n'));
      const unsupportedServerCapability = await runCheck(root);
      expect(JSON.parse(unsupportedServerCapability.stdout).checks).toContainEqual(expect.objectContaining({
        phase: 'policy',
        code: 'SERVER_CAPABILITY_FORBIDDEN',
        summary: "Server source uses unsupported portable capability 'dynamic_code_generation'.",
        location: { file: 'widget://backend/functions.ts' },
      }));

      await mkdir(join(root, 'helpers'), { recursive: true });
      await writeFile(
        join(root, 'helpers/query.server.ts'),
        'import { readFile } from "node:fs";\nexport const query = readFile;\n',
      );
      await writeFile(join(root, 'backend/functions.ts'), [
        'import { defineServerFunction } from "@omnidraw/sdk/server";',
        'import { query } from "../helpers/query.server";',
        'const schema = {};',
        'void query;',
        'export const run = defineServerFunction({',
        '  effect: "fn", input: schema, output: schema,',
        '}, async () => ({}));',
        '',
      ].join('\n'));
      const dottedHelper = await runCheck(root);
      expect(JSON.parse(dottedHelper.stdout).checks).toContainEqual(expect.objectContaining({
        phase: 'policy',
        code: 'SOURCE_IMPORT_FORBIDDEN',
        location: expect.objectContaining({ file: 'widget://helpers/query.server.ts' }),
      }));

      await writeFile(join(root, 'backend/functions.ts'), [
        'import { defineServerFunction } from "@omnidraw/sdk/server";',
        'export * from "node:fs";',
        'const schema = {};',
        'export const run = defineServerFunction({',
        '  effect: "fn", input: schema, output: schema,',
        '}, async () => ({}));',
        '',
      ].join('\n'));
      const forbiddenReExport = await runCheck(root);
      expect(JSON.parse(forbiddenReExport.stdout).checks).toContainEqual(expect.objectContaining({
        phase: 'policy',
        code: 'SOURCE_IMPORT_FORBIDDEN',
        location: expect.objectContaining({ file: 'widget://backend/functions.ts', line: 2 }),
      }));

      const invalidCli = await runCheck(root, ['check', '.', 'second']);
      expect(invalidCli.exitCode).toBe(2);
      expect(invalidCli.stdout).toBe('');
      expect(invalidCli.stderr).toContain('CLI_INVALID');
      expect(invalidCli.stderr).not.toContain(base);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }, 30_000);

  test('allows @omnidraw/sdk/server on server modules imported by UI and forbids it in UI and shared modules', async () => {
    const base = await mkdtemp('/tmp/omnidraw-offline-server-import-');
    const root = join(base, 'project');
    await mkdir(root);
    try {
      await createProject(root);
      await mkdir(join(root, 'server'), { recursive: true });
      await writeFile(join(root, 'server/main.server.ts'), [
        'import { defineServerFunction } from "@omnidraw/sdk/server";',
        'const schema = {};',
        'export const addContact = defineServerFunction({',
        '  effect: "fn", input: schema, output: schema,',
        '}, async () => ({}));',
        'export const listContacts = defineServerFunction({',
        '  effect: "fn", input: schema, output: schema,',
        '}, async () => ({}));',
        '',
      ].join('\n'));
      await writeFile(join(root, 'ui/main.ts'), [
        'import { addContact, listContacts } from "../server/main.server";',
        'void addContact;',
        'void listContacts;',
        '',
      ].join('\n'));
      await writeFile(join(root, 'omnidraw.json'), `${JSON.stringify(manifest({
        server: { entry: 'server/main.server.ts' },
      }))}\n`);
      const uiImportsServer = await runCheck(root);
      expect(JSON.parse(uiImportsServer.stdout).checks).not.toContainEqual(expect.objectContaining({
        phase: 'policy',
        code: 'SOURCE_IMPORT_FORBIDDEN',
        location: expect.objectContaining({ file: 'widget://server/main.server.ts' }),
      }));

      await writeFile(join(root, 'ui/main.ts'), [
        'import { defineServerFunction } from "@omnidraw/sdk/server";',
        'void defineServerFunction;',
        '',
      ].join('\n'));
      const uiImportsServerSdk = await runCheck(root);
      expect(JSON.parse(uiImportsServerSdk.stdout).checks).toContainEqual(expect.objectContaining({
        phase: 'policy',
        code: 'SOURCE_IMPORT_FORBIDDEN',
        location: expect.objectContaining({ file: 'widget://ui/main.ts', line: 1 }),
      }));

      await writeFile(join(root, 'ui/main.ts'), [
        'const node = document.createElement("div");',
        'document.body.append(node);',
        '',
      ].join('\n'));
      await mkdir(join(root, 'shared'), { recursive: true });
      await writeFile(join(root, 'shared/model.shared.ts'), [
        'import { defineServerFunction } from "@omnidraw/sdk/server";',
        'void defineServerFunction;',
        '',
      ].join('\n'));
      const sharedImportsServerSdk = await runCheck(root);
      expect(JSON.parse(sharedImportsServerSdk.stdout).checks).toContainEqual(expect.objectContaining({
        phase: 'policy',
        code: 'SOURCE_IMPORT_FORBIDDEN',
        location: expect.objectContaining({ file: 'widget://shared/model.shared.ts', line: 1 }),
      }));
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }, 30_000);

  test('fails closed on authored symlinks without following them', async () => {
    const base = await mkdtemp('/tmp/omnidraw-offline-symlink-');
    const root = join(base, 'project');
    await mkdir(root);
    try {
      await createProject(root);
      await symlink(join(base, 'outside.ts'), join(root, 'ui/outside.ts'));
      const result = await runCheck(root);
      expect(result).toMatchObject({ exitCode: 3, stderr: '' });
      expect(JSON.parse(result.stdout).checks).toContainEqual(expect.objectContaining({
        phase: 'project', code: 'PROJECT_SYMLINK_UNSAFE',
      }));
      expect(result.stdout).not.toContain(base);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
