#!/usr/bin/env bun

/**
 * Finalize one workspace library distribution as a standalone npm package.
 *
 * With no arguments this preserves the release-build convention of finalizing
 * `<cwd>/dist`. Registry staging supplies both `--package-root` and
 * `--dist-root`; the package root stays the source/configuration authority while
 * every generated file remains below the caller-owned staging directory.
 */

import { copyFile, lstat, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import {
  PUBLIC_PACKAGE_DIRECTORIES,
  readPublicPackageSet,
} from './public-packages'

type TManifest = Record<string, unknown> & {
  name?: string
  version?: string
  exports?: unknown
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const REPOSITORY_ROOT = resolve(import.meta.dir, '..')
const PROTOCOL_PATTERN = /['"](?:workspace|catalog|file|link):/
const PROTOCOL_SPECIFIER = /^(?:workspace|catalog|file|link):/
const PUBLIC_MANIFEST_FIELDS = Object.freeze([
  'name',
  'version',
  'description',
  'keywords',
  'type',
  'license',
  'author',
  'contributors',
  'funding',
  'homepage',
  'repository',
  'bugs',
  'engines',
  'sideEffects',
  'bin',
  'peerDependenciesMeta',
] as const)

async function readJson(path: string): Promise<TManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as TManifest
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export type TPackageDistDirectories = Readonly<{
  packageDirectory: string
  distDirectory: string
  explicit: boolean
}>

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a directory.`)
  return value
}

function isInside(root: string, candidate: string): boolean {
  const nested = relative(root, candidate)
  return nested === '' || (!nested.startsWith(`..${sep}`) && nested !== '..' && !isAbsolute(nested))
}

export function packageDistDirectories(
  args: readonly string[],
  cwd = process.cwd(),
  repositoryRoot = REPOSITORY_ROOT,
): TPackageDistDirectories {
  const packageRoot = optionValue(args, '--package-root')
  const distRoot = optionValue(args, '--dist-root')
  if ((packageRoot === undefined) !== (distRoot === undefined)) {
    throw new Error('--package-root and --dist-root must be supplied together.')
  }
  const packageDirectory = resolve(cwd, packageRoot ?? '.')
  const distDirectory = resolve(cwd, distRoot ?? 'dist')
  if (distDirectory === parse(distDirectory).root || distDirectory === packageDirectory) {
    throw new Error('The package distribution root must be a dedicated child directory.')
  }
  const explicit = packageRoot !== undefined
  if (explicit && isInside(repositoryRoot, distDirectory)) {
    throw new Error('An explicit package distribution root must be outside the source repository.')
  }
  if (!explicit && distDirectory !== join(packageDirectory, 'dist')) {
    throw new Error('The default package distribution root must be <package>/dist.')
  }
  return Object.freeze({ packageDirectory, distDirectory, explicit })
}

async function workspacePackages(repositoryRoot: string): Promise<ReadonlyMap<string, TManifest>> {
  const manifests = new Map<string, TManifest>()
  for (const [expectedName, directory] of Object.entries(PUBLIC_PACKAGE_DIRECTORIES)) {
    const manifestPath = join(repositoryRoot, directory, 'package.json')
    const manifest = await readJson(manifestPath)
    if (manifest.name !== expectedName || typeof manifest.version !== 'string') {
      throw new Error(`${directory}/package.json has an invalid public package identity.`)
    }
    manifests.set(expectedName, manifest)
  }
  return manifests
}

function publicTarget(target: string): string {
  if (target.startsWith('./dist/')) return `./${target.slice('./dist/'.length)}`
  if (!target.startsWith('./src/')) return target
  const relativeTarget = target.slice('./src/'.length)
  if (relativeTarget.includes('*') && !/\.[cm]?[jt]sx?$/.test(relativeTarget)) {
    return `./${relativeTarget}.js`
  }
  if (relativeTarget.endsWith('.d.ts')) return `./${relativeTarget}`
  if (/\.[cm]?tsx?$/.test(relativeTarget)) {
    return `./${relativeTarget.replace(/\.[cm]?tsx?$/, '.js')}`
  }
  return `./${relativeTarget}`
}

function declarationTarget(target: string): string | null {
  const publicPath = publicTarget(target)
  if (publicPath.endsWith('.d.ts')) return publicPath
  if (!/\.(?:[cm]?js|[cm]?ts|tsx?|jsx?)$/.test(publicPath) && !publicPath.includes('*')) {
    return null
  }
  return publicPath.replace(/\.[cm]?[jt]sx?$/, '.d.ts')
}

function publicExport(value: unknown): unknown {
  if (typeof value === 'string') {
    const target = publicTarget(value)
    const types = declarationTarget(value)
    return types === null ? target : { types, import: target, default: target }
  }
  if (Array.isArray(value)) return value.map(publicExport)
  if (value === null || typeof value !== 'object') return value
  const entries = Object.entries(value)
  const isSubpathMap = entries.some(([key]) => key.startsWith('.'))
  return Object.fromEntries(entries.map(([condition, target]) => [
    condition,
    isSubpathMap || typeof target !== 'string' ? publicExport(target) : publicTarget(target),
  ]))
}

function exportedTargets(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(exportedTargets)
  if (value === null || typeof value !== 'object') return []
  return Object.values(value).flatMap(exportedTargets)
}

function isCatalogSpecifier(specifier: string): boolean {
  return specifier === 'catalog' || specifier === 'catalog:' || specifier.startsWith('catalog:')
}

export function resolveDependencySpec(
  dependency: string,
  specifier: string,
  rootCatalog: Readonly<Record<string, string>>,
  workspaces: ReadonlyMap<string, TManifest>,
): string {
  const workspace = workspaces.get(dependency)
  if (workspace?.version !== undefined) {
    if (typeof workspace.version !== 'string') throw new Error(`${dependency} has an invalid workspace version.`)
    return workspace.version
  }
  if (isCatalogSpecifier(specifier)) {
    const catalogValue = rootCatalog[dependency]
    if (catalogValue === undefined) throw new Error(`${dependency} is absent from the root catalog.`)
    return catalogValue
  }
  if (PROTOCOL_SPECIFIER.test(specifier)) {
    throw new Error(`${dependency} uses unsupported public dependency specifier ${specifier}.`)
  }
  return specifier
}

function publicDependencies(
  dependencies: Record<string, string> | undefined,
  rootCatalog: Readonly<Record<string, string>>,
  workspaces: ReadonlyMap<string, TManifest>,
): Record<string, string> | undefined {
  if (dependencies === undefined) return undefined
  return Object.fromEntries(Object.entries(dependencies).map(([dependency, specifier]) => [
    dependency,
    resolveDependencySpec(dependency, specifier, rootCatalog, workspaces),
  ]))
}

async function filesBelow(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return filesBelow(path)
    return entry.isFile() ? [path] : []
  }))
  return nested.flat()
}

function localModuleTarget(sourcePath: string, specifier: string): string | null {
  if (!specifier.startsWith('.') || /\.(?:[cm]?[jt]sx?|json|node|css)$/.test(specifier)) return null
  const base = resolve(dirname(sourcePath), specifier)
  const fileTarget = `${base}.js`
  const indexTarget = join(base, 'index.js')
  return relative(dirname(sourcePath), fileTarget).split(sep).join('/').replace(/^(?!\.)/, './')
    + `\0${relative(dirname(sourcePath), indexTarget).split(sep).join('/').replace(/^(?!\.)/, './')}`
}

async function rewriteLocalEsmSpecifiers(path: string): Promise<void> {
  if (!path.endsWith('.js') && !path.endsWith('.d.ts')) return
  let source = await readFile(path, 'utf8')
  const candidates = [...source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)(['"])(\.[^'"]+)\1/g)]
  for (const match of candidates) {
    const specifier = match[2]!
    const targets = localModuleTarget(path, specifier)
    if (targets === null) continue
    const [fileSpecifier, indexSpecifier] = targets.split('\0')
    const filePath = resolve(dirname(path), fileSpecifier!)
    const indexPath = resolve(dirname(path), indexSpecifier!)
    const replacement = await pathExists(filePath)
      ? fileSpecifier!
      : await pathExists(indexPath)
        ? indexSpecifier!
        : null
    if (replacement !== null) {
      const escapedSpecifier = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const quotedSpecifier = new RegExp(`(['"])${escapedSpecifier}\\1`, 'g')
      source = source.replace(quotedSpecifier, (_match, quote: string) => `${quote}${replacement}${quote}`)
    }
  }
  await writeFile(path, source)
}

async function copyDocumentation(
  repositoryRoot: string,
  packageDirectory: string,
  distDirectory: string,
  name: 'LICENSE' | 'README.md',
): Promise<void> {
  const packagePath = join(packageDirectory, name)
  const sourcePath = await pathExists(packagePath) ? packagePath : join(repositoryRoot, name)
  await copyFile(sourcePath, join(distDirectory, name))
}

export async function preparePackageDist(
  directories: TPackageDistDirectories,
  repositoryRoot = REPOSITORY_ROOT,
): Promise<void> {
  const { packageDirectory, distDirectory } = directories
  const manifest = await readJson(join(packageDirectory, 'package.json'))
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error(`${relative(repositoryRoot, packageDirectory)} must have a public name and version.`)
  }
  const packageSet = await readPublicPackageSet(repositoryRoot)
  const expectedDirectory = PUBLIC_PACKAGE_DIRECTORIES[
    manifest.name as keyof typeof PUBLIC_PACKAGE_DIRECTORIES
  ]
  if (expectedDirectory === undefined) {
    throw new Error(`${manifest.name} is not one of the five public Omnidraw packages.`)
  }
  if (resolve(repositoryRoot, expectedDirectory) !== packageDirectory) {
    throw new Error(`${manifest.name} must be staged from ${expectedDirectory}.`)
  }
  if (packageSet.packages[manifest.name as keyof typeof packageSet.packages] !== manifest.version) {
    throw new Error(`${manifest.name}@${manifest.version} is not the qualified public-package-set version.`)
  }
  const distStat = await lstat(distDirectory).catch(() => null)
  if (distStat === null || !distStat.isDirectory() || distStat.isSymbolicLink()) {
    throw new Error(`${manifest.name} build did not create a regular distribution root.`)
  }

  const rootManifest = await readJson(join(repositoryRoot, 'package.json'))
  const rootCatalog = (rootManifest.catalog ?? {}) as Record<string, string>
  const workspaces = await workspacePackages(repositoryRoot)
  const publicManifest: TManifest = {}
  for (const field of PUBLIC_MANIFEST_FIELDS) {
    if (manifest[field] !== undefined) {
      (publicManifest as Record<string, unknown>)[field] = manifest[field]
    }
  }
  if (typeof publicManifest.sideEffects === 'string') {
    publicManifest.sideEffects = publicTarget(publicManifest.sideEffects)
  } else if (Array.isArray(publicManifest.sideEffects)) {
    publicManifest.sideEffects = publicManifest.sideEffects.map((value) => (
      typeof value === 'string' ? publicTarget(value) : value
    ))
  }
  publicManifest.name = manifest.name
  publicManifest.version = manifest.version
  publicManifest.type = manifest.type ?? 'module'
  publicManifest.license = manifest.license ?? rootManifest.license ?? 'MIT'
  publicManifest.repository = manifest.repository ?? {
    type: 'git',
    url: 'git+https://github.com/omnidraw/omnidraw.git',
    directory: relative(repositoryRoot, packageDirectory),
  }
  if (publicManifest.bin !== undefined) {
    if (typeof publicManifest.bin === 'string') {
      publicManifest.bin = publicTarget(publicManifest.bin)
    } else if (publicManifest.bin !== null && typeof publicManifest.bin === 'object') {
      publicManifest.bin = Object.fromEntries(
        Object.entries(publicManifest.bin).map(([name, target]) => [
          name,
          typeof target === 'string' ? publicTarget(target) : target,
        ]),
      )
    }
  }
  publicManifest.publishConfig = {
    access: 'public',
    provenance: true,
    registry: 'https://registry.npmjs.org/',
  }
  publicManifest.exports = publicExport(manifest.exports)

  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    const resolved = publicDependencies(manifest[field], rootCatalog, workspaces)
    if (resolved !== undefined) publicManifest[field] = resolved
  }

  const rootMain = typeof manifest.main === 'string' ? publicTarget(manifest.main) : undefined
  const rootModule = typeof manifest.module === 'string' ? publicTarget(manifest.module) : undefined
  const rootTypes = typeof manifest.types === 'string' ? publicTarget(manifest.types) : undefined
  if (rootMain !== undefined) publicManifest.main = rootMain
  if (rootModule !== undefined) publicManifest.module = rootModule
  if (rootTypes !== undefined) publicManifest.types = rootTypes

  await Promise.all([
    copyDocumentation(repositoryRoot, packageDirectory, distDirectory, 'LICENSE'),
    copyDocumentation(repositoryRoot, packageDirectory, distDirectory, 'README.md'),
  ])
  const emittedFiles = await filesBelow(distDirectory)
  await Promise.all(emittedFiles.map(rewriteLocalEsmSpecifiers))

  const manifestText = `${JSON.stringify(publicManifest, null, 2)}\n`
  if (PROTOCOL_PATTERN.test(manifestText) || manifestText.includes(repositoryRoot)) {
    throw new Error(`${manifest.name} generated a non-portable public manifest.`)
  }
  await writeFile(join(distDirectory, 'package.json'), manifestText)

  for (const target of exportedTargets(publicManifest.exports)) {
    if (target.includes('*')) continue
    const targetPath = resolve(distDirectory, target)
    if (!targetPath.startsWith(`${distDirectory}${sep}`) || !await pathExists(targetPath)) {
      throw new Error(`${manifest.name} export target does not exist in dist: ${target}`)
    }
  }

  const displayDirectory = directories.explicit
    ? distDirectory
    : relative(repositoryRoot, distDirectory)
  console.log(`[package-dist] ${manifest.name}@${manifest.version} is ready at ${displayDirectory}`)
}

if (import.meta.main) {
  await preparePackageDist(packageDistDirectories(process.argv.slice(2)))
}
