#!/usr/bin/env node
/**
 * @file Opt-in cross-repo local linking for `@omnidraw/capsule` and
 * `@omnidraw/cangine` (D9). Off by default: normal `bun install`/`bun run dev`
 * never touch this file and keep resolving both from real npm at the pinned
 * `catalog`/devDependency versions.
 *
 * `bun run link:local -- capsule cangine` (or `OMNIDRAW_LINK_LOCAL=capsule,cangine
 * bun run link:local`) builds and publishes the requested sibling repo(s) into
 * this checkout's local registry (via `scripts/local-registry.mjs`, so it's
 * the same instance `bun run dev` uses for widget-package sync), then writes a
 * repo-root `.npmrc` pointing `@omnidraw:registry` at it. Run
 * `bun run link:local:reset` to remove that `.npmrc` and go back to normal
 * resolution. `bun install` still has to be re-run after either command for
 * the change to take effect.
 *
 * Each sibling repository owns its own build/pack/publish pipeline — this
 * script does not reimplement it. It looks for one of a few conventional
 * script names in the sibling's own `package.json` and runs it with
 * `--registry <local registry> --userconfig <local npm userconfig>`, exactly
 * the contract both the capsule and cangine repos already expose.
 */

import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const NPMRC_PATH = join(REPOSITORY_ROOT, '.npmrc');
const LOCAL_REGISTRY_SCRIPT = join(REPOSITORY_ROOT, 'scripts', 'local-registry.mjs');

const KNOWN_PACKAGES = Object.freeze({
  capsule: Object.freeze({
    packageName: '@omnidraw/capsule',
    pathEnv: 'OMNIDRAW_CAPSULE_LOCAL_PATH',
    defaultSibling: 'capsule',
  }),
  cangine: Object.freeze({
    packageName: '@omnidraw/cangine',
    pathEnv: 'OMNIDRAW_CANGINE_LOCAL_PATH',
    defaultSibling: 'cangine',
  }),
});

// Producer repos have historically named this script slightly differently;
// try each in order rather than hard-coding one shape per repo.
const LOCAL_PUBLISH_SCRIPT_NAMES = Object.freeze([
  'package:publish:local',
  'package:publish-local',
  'publish:local',
]);

export function parseLinkTargets(rawNames) {
  const names = [...new Set(rawNames.map((name) => name.trim()).filter((name) => name !== ''))];
  for (const name of names) {
    if (!(name in KNOWN_PACKAGES)) {
      throw new Error(
        `Unknown local-link target "${name}". Known targets: ${Object.keys(KNOWN_PACKAGES).join(', ')}.`,
      );
    }
  }
  return names;
}

export function resolveSiblingDirectory(name, env, repositoryRoot) {
  const config = KNOWN_PACKAGES[name];
  const override = env[config.pathEnv];
  if (typeof override === 'string' && override.trim() !== '') return resolve(override);
  return resolve(repositoryRoot, '..', config.defaultSibling);
}

export function selectLocalPublishScript(scripts = {}) {
  return LOCAL_PUBLISH_SCRIPT_NAMES.find((candidate) => scripts[candidate] !== undefined) ?? null;
}

export function npmrcContents(registryUrl) {
  const registry = new URL(registryUrl);
  const registryAuthKey = `//${registry.host}${registry.pathname}`;
  return [
    '# Written by `bun run link:local` (see tasks/d/D9.md). Resolves @omnidraw/*',
    '# from the local dev registry instead of real npm for this checkout only.',
    '# Run `bun run link:local:reset` to remove this file.',
    `@omnidraw:registry=${registryUrl}`,
    `${registryAuthKey}:_authToken=omnidraw-local-development`,
    '',
  ].join('\n');
}

function runCaptured(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPOSITORY_ROOT,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) { resolvePromise({ stdout, stderr }); return; }
      reject(new Error([
        `Command failed (${signal ?? code}): ${command} ${args.join(' ')}`,
        stdout.trim(),
        stderr.trim(),
      ].filter(Boolean).join('\n')));
    });
  });
}

function runInherited(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPOSITORY_ROOT,
      env: options.env ?? process.env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) { resolvePromise(); return; }
      reject(new Error(`Command failed (${signal ?? code}): ${command} ${args.join(' ')}`));
    });
  });
}

async function ensureLocalRegistry() {
  const { stdout } = await runCaptured('node', [LOCAL_REGISTRY_SCRIPT, 'ensure']);
  return JSON.parse(stdout);
}

async function resolveLocalPublishScript(directory, name) {
  const manifestPath = join(directory, 'package.json');
  const manifest = await readFile(manifestPath, 'utf8')
    .then((source) => JSON.parse(source))
    .catch(() => {
      throw new Error(
        `${KNOWN_PACKAGES[name].packageName}: no package.json at ${directory}. `
        + `Set ${KNOWN_PACKAGES[name].pathEnv} to the correct sibling checkout.`,
      );
    });
  if (manifest.name !== KNOWN_PACKAGES[name].packageName) {
    throw new Error(
      `${directory} is "${manifest.name ?? 'unnamed'}", expected `
      + `"${KNOWN_PACKAGES[name].packageName}". Set ${KNOWN_PACKAGES[name].pathEnv} `
      + 'to the correct sibling checkout.',
    );
  }
  const scriptName = selectLocalPublishScript(manifest.scripts);
  if (scriptName === null) {
    throw new Error(
      `${directory} has no known local-publish script (looked for `
      + `${LOCAL_PUBLISH_SCRIPT_NAMES.join(', ')}). Its own package.json must `
      + 'expose one to be linkable.',
    );
  }
  return { manifest, scriptName };
}

async function linkPackages(names) {
  const registry = await ensureLocalRegistry();
  for (const name of names) {
    const directory = resolveSiblingDirectory(name, process.env, REPOSITORY_ROOT);
    await access(directory).catch(() => {
      throw new Error(
        `${KNOWN_PACKAGES[name].packageName}: no checkout found at ${directory}. `
        + `Set ${KNOWN_PACKAGES[name].pathEnv} to the correct path.`,
      );
    });
    const { manifest, scriptName } = await resolveLocalPublishScript(directory, name);
    console.log(`[link:local] publishing ${manifest.name}@${manifest.version} from ${directory} via "${scriptName}"...`);
    await runInherited('bun', [
      'run', scriptName, '--',
      '--registry', registry.registryUrl,
      '--userconfig', registry.npmUserConfigPath,
    ], { cwd: directory });
  }
  await writeFile(NPMRC_PATH, npmrcContents(registry.registryUrl));
  console.log(`[link:local] wrote ${NPMRC_PATH} — @omnidraw:registry now resolves to ${registry.registryUrl}.`);
  console.log('[link:local] run `bun install` to pick up the linked package(s); `bun run link:local:reset` to undo.');
}

async function resetLink() {
  await rm(NPMRC_PATH, { force: true });
  console.log(`[link:local] removed ${NPMRC_PATH} — @omnidraw:registry resolves to real npm again after the next \`bun install\`.`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'reset') { await resetLink(); return; }
  const envNames = (process.env.OMNIDRAW_LINK_LOCAL ?? '').split(',');
  const rawNames = command === undefined ? envNames : [command, ...rest];
  const names = parseLinkTargets(rawNames);
  if (names.length === 0) {
    throw new Error(
      'Specify at least one package to link: `bun run link:local -- capsule cangine` '
      + 'or `OMNIDRAW_LINK_LOCAL=capsule,cangine bun run link:local`.',
    );
  }
  await linkPackages(names);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
