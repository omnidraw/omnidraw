#!/usr/bin/env bun

/** Build, inspect, pack, install, and import every versioned workspace library. */

import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'

type TManifest = Record<string, unknown> & {
  name?: string
  version?: string
  exports?: unknown
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

type TPackage = Readonly<{
  directory: string
  manifest: TManifest
  name: string
  version: string
}>

type TPacked = Readonly<TPackage & { tarball: string }>

const REPOSITORY_ROOT = resolve(import.meta.dir, '..')
const PACKAGES_DIRECTORY = join(REPOSITORY_ROOT, 'packages')
const FORBIDDEN_PROTOCOL = /['"](?:workspace|catalog|file|link):/
const TEXT_FILE = /\.(?:css|d\.ts|js|json|map|md|txt)$/

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function run(command: readonly string[], cwd: string): Promise<string> {
  const child = Bun.spawn([...command], {
    cwd,
    env: { ...process.env, CI: process.env.CI ?? '1' },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) {
    throw new Error([`Command failed (${exitCode}): ${command.join(' ')}`, stdout, stderr]
      .map((line) => line.trim()).filter(Boolean).join('\n'))
  }
  return stdout.trim()
}

async function versionedPackages(): Promise<readonly TPackage[]> {
  const entries = await readdir(PACKAGES_DIRECTORY, { withFileTypes: true })
  const packages: TPackage[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const directory = join(PACKAGES_DIRECTORY, entry.name)
    const manifestPath = join(directory, 'package.json')
    if (!await pathExists(manifestPath)) continue
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as TManifest
    if (manifest.version === undefined) continue
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new Error(`${relative(REPOSITORY_ROOT, manifestPath)} has an invalid release identity.`)
    }
    packages.push({ directory, manifest, name: manifest.name, version: manifest.version })
  }
  return packages.sort((left, right) => left.name.localeCompare(right.name))
}

function dependencyNames(manifest: TManifest): readonly string[] {
  return ['dependencies', 'optionalDependencies', 'peerDependencies']
    .flatMap((field) => Object.keys((manifest[field] ?? {}) as Record<string, string>))
}

function dependencyOrder(packages: readonly TPackage[]): readonly TPackage[] {
  const byName = new Map(packages.map((entry) => [entry.name, entry]))
  const remaining = new Map(byName)
  const ordered: TPackage[] = []
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((entry) => dependencyNames(entry.manifest)
      .every((dependency) => !remaining.has(dependency)))
    if (ready.length === 0) throw new Error(`Versioned package dependency cycle: ${[...remaining.keys()].join(', ')}`)
    ready.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of ready) {
      remaining.delete(entry.name)
      ordered.push(entry)
    }
  }
  return ordered
}

function targets(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(targets)
  if (value === null || typeof value !== 'object') return []
  return Object.values(value).flatMap(targets)
}

function moduleSpecifiers(source: string): readonly string[] {
  return [
    ...[...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^;'"`]+?\s+from\s+)?['"]([^'"]+)['"]/g)]
      .map((match) => match[1]!),
    ...[...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]!),
  ]
}

function importedPackageName(specifier: string): string | null {
  if (
    specifier.startsWith('.')
    || specifier.startsWith('/')
    || specifier.startsWith('#')
    || /^(?:bun|capsule|data|node):/.test(specifier)
  ) return null
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0] ?? null
}

async function filesBelow(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path) : entry.isFile() ? [path] : []
  }))).flat()
}

async function assertStandaloneDist(entry: TPackage, versions: ReadonlyMap<string, string>): Promise<TManifest> {
  const dist = join(entry.directory, 'dist')
  const manifest = JSON.parse(await readFile(join(dist, 'package.json'), 'utf8')) as TManifest
  if (manifest.name !== entry.name || manifest.version !== entry.version || manifest.private === true) {
    throw new Error(`${entry.name} dist has an invalid public identity.`)
  }
  const manifestText = JSON.stringify(manifest)
  if (FORBIDDEN_PROTOCOL.test(manifestText) || manifestText.includes(REPOSITORY_ROOT)) {
    throw new Error(`${entry.name} dist manifest contains a workspace or repository reference.`)
  }
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    for (const [dependency, specifier] of Object.entries(manifest[field] ?? {})) {
      const internalVersion = versions.get(dependency)
      if (internalVersion !== undefined && specifier !== internalVersion) {
        throw new Error(`${entry.name} dist pins ${dependency} to ${specifier}; expected ${internalVersion}.`)
      }
    }
  }

  for (const target of targets(manifest.exports)) {
    if (target.includes('*')) continue
    const absolute = resolve(dist, target)
    if (!absolute.startsWith(`${dist}${sep}`) || !await pathExists(absolute)) {
      throw new Error(`${entry.name} dist export is missing: ${target}`)
    }
  }

  const files = await filesBelow(dist)
  const sourceFiles = files.filter((path) => ['.ts', '.tsx', '.jsx'].includes(extname(path)) && !path.endsWith('.d.ts'))
  if (sourceFiles.length > 0) throw new Error(`${entry.name} dist contains source modules: ${sourceFiles.join(', ')}`)
  const declared = new Set(['dependencies', 'optionalDependencies', 'peerDependencies']
    .flatMap((field) => Object.keys((manifest[field] ?? {}) as Record<string, string>)))
  for (const path of files.filter((candidate) => TEXT_FILE.test(candidate))) {
    const text = await readFile(path, 'utf8')
    if (text.includes(REPOSITORY_ROOT) || FORBIDDEN_PROTOCOL.test(text)) {
      throw new Error(`${entry.name} dist file is not portable: ${relative(dist, path)}`)
    }
    if (path.endsWith('.d.ts') && /(?:\.\.\/)+(?:apps|packages)\//.test(text)) {
      throw new Error(`${entry.name} declaration reaches into the repository: ${relative(dist, path)}`)
    }
    if (path.endsWith('.js')) {
      for (const specifier of moduleSpecifiers(text)) {
        const dependency = importedPackageName(specifier)
        if (dependency !== null && dependency !== entry.name && !declared.has(dependency)) {
          throw new Error(`${entry.name} imports undeclared ${dependency} from ${relative(dist, path)}.`)
        }
      }
    }
  }
  return manifest
}

async function buildAndPack(
  entry: TPackage,
  versions: ReadonlyMap<string, string>,
  packDirectory: string,
): Promise<TPacked> {
  await run(['bun', 'run', 'build'], entry.directory)
  const publicManifest = await assertStandaloneDist(entry, versions)
  await run(['npm', 'pack', '--dry-run', '--json'], join(entry.directory, 'dist'))
  const output = await run(['bun', 'pm', 'pack', '--destination', packDirectory, '--quiet'], join(entry.directory, 'dist'))
  const reported = output.split('\n').filter(Boolean).at(-1)
  if (reported === undefined) throw new Error(`${entry.name} pack did not report a tarball.`)
  const tarball = resolve(join(entry.directory, 'dist'), reported)
  if (dirname(tarball) !== packDirectory) throw new Error(`${entry.name} pack escaped the isolated output directory.`)
  return { ...entry, manifest: publicManifest, tarball }
}

function publicJsSubpaths(manifest: TManifest): readonly string[] {
  if (manifest.exports === null || typeof manifest.exports !== 'object') return []
  return Object.entries(manifest.exports).flatMap(([subpath, value]) => {
    if (subpath.includes('*')) return []
    const exported = targets(value)
    return exported.some((target) => target.endsWith('.js'))
      ? [subpath === '.' ? manifest.name! : `${manifest.name}${subpath.slice(1)}`]
      : []
  })
}

async function packInstalledDependency(name: string, packDirectory: string): Promise<string> {
  const installed = await realpath(join(REPOSITORY_ROOT, 'node_modules', ...name.split('/')))
  const output = await run(['bun', 'pm', 'pack', '--destination', packDirectory, '--quiet'], installed)
  const reported = output.split('\n').filter(Boolean).at(-1)
  if (reported === undefined) throw new Error(`${name} pack did not report a tarball.`)
  return resolve(installed, reported)
}

async function assertCleanConsumer(packed: readonly TPacked[], temporaryRoot: string): Promise<void> {
  const consumer = join(temporaryRoot, 'consumer')
  await mkdir(consumer, { recursive: true })
  const internalTarballs = Object.fromEntries(packed.map((entry) => [entry.name, `file:${entry.tarball}`]))
  const cangine = await packInstalledDependency('@omnidraw/cangine', join(temporaryRoot, 'packs'))
  const overrides = { ...internalTarballs, '@omnidraw/cangine': `file:${cangine}` }
  await writeFile(join(consumer, 'package.json'), `${JSON.stringify({
    name: '@omnidraw-fixtures/all-package-dists',
    private: true,
    type: 'module',
    dependencies: {
      ...internalTarballs,
      'solid-js': '^1.9.14',
      typescript: '7.0.2',
    },
    overrides,
  }, null, 2)}\n`)
  await run(['bun', 'install', '--ignore-scripts'], consumer)

  const imports = packed.flatMap((entry) => (
    entry.name === '@omnidraw/canvas'
      ? []
      : publicJsSubpaths(entry.manifest).filter((specifier) => (
        entry.name !== '@omnidraw/sdk' || specifier === '@omnidraw/sdk/server'
      ))
  ))
  const bunSmokePath = join(consumer, 'smoke-bun.mjs')
  await writeFile(bunSmokePath, `${imports.map((specifier) => `await import(${JSON.stringify(specifier)})`).join('\n')}\nconsole.log('all Bun package imports passed')\n`)
  const bunSmoke = await run(['bun', basename(bunSmokePath)], consumer)
  if (!bunSmoke.includes('all Bun package imports passed')) throw new Error('Clean Bun package import smoke did not finish.')

  const nodeImports = imports.filter((specifier) => !specifier.endsWith('/local'))
  const nodeSmokePath = join(consumer, 'smoke-node.mjs')
  await writeFile(nodeSmokePath, `${nodeImports.map((specifier) => `await import(${JSON.stringify(specifier)})`).join('\n')}\nconsole.log('portable Node package imports passed')\n`)
  const nodeSmoke = await run(['node', basename(nodeSmokePath)], consumer)
  if (!nodeSmoke.includes('portable Node package imports passed')) throw new Error('Clean Node package import smoke did not finish.')

  const lock = await readFile(join(consumer, 'bun.lock'), 'utf8')
  if (lock.includes(REPOSITORY_ROOT) || lock.includes('workspace:') || lock.includes('catalog:')) {
    throw new Error('Clean consumer lockfile retained repository or workspace resolution.')
  }
}

async function main(): Promise<void> {
  const packages = versionedPackages()
  const ordered = dependencyOrder(await packages)
  const versions = new Map(ordered.map((entry) => [entry.name, entry.version]))
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'omnidraw-package-dists-'))
  const packDirectory = join(temporaryRoot, 'packs')
  process.env.npm_config_cache = join(temporaryRoot, 'npm-cache')
  process.env.BUN_INSTALL_CACHE_DIR = join(temporaryRoot, 'bun-cache')
  process.env.TMPDIR = join(temporaryRoot, 'tmp')
  await Promise.all([
    mkdir(packDirectory, { recursive: true }),
    mkdir(process.env.TMPDIR, { recursive: true }),
  ])
  try {
    const packed: TPacked[] = []
    for (const entry of ordered) packed.push(await buildAndPack(entry, versions, packDirectory))
    await assertCleanConsumer(packed, temporaryRoot)
    console.log(`[package-dists] ${packed.map((entry) => `${entry.name}@${entry.version}`).join(', ')} passed build, npm dry-run pack, isolated pack, clean install, Bun import smoke, and portable Node ESM import smoke`)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

await main()
