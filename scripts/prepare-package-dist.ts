#!/usr/bin/env bun

/**
 * Finalize one workspace library's dist directory as a standalone npm package.
 *
 * Run from a versioned package after its compiler/bundler has populated dist/.
 * The workspace manifest remains optimized for local linking; the generated
 * dist/package.json is the only manifest intended for npm publication.
 */

import { copyFile, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
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

const PACKAGE_DIRECTORY = resolve(process.cwd())
const REPOSITORY_ROOT = resolve(import.meta.dir, '..')
const DIST_DIRECTORY = join(PACKAGE_DIRECTORY, 'dist')
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

async function workspacePackages(): Promise<ReadonlyMap<string, TManifest>> {
  const manifests = new Map<string, TManifest>()
  for (const [expectedName, directory] of Object.entries(PUBLIC_PACKAGE_DIRECTORIES)) {
    const manifestPath = join(REPOSITORY_ROOT, directory, 'package.json')
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

async function copyDocumentation(name: 'LICENSE' | 'README.md'): Promise<void> {
  const packagePath = join(PACKAGE_DIRECTORY, name)
  const sourcePath = await pathExists(packagePath) ? packagePath : join(REPOSITORY_ROOT, name)
  await copyFile(sourcePath, join(DIST_DIRECTORY, name))
}

async function main(): Promise<void> {
  const manifest = await readJson(join(PACKAGE_DIRECTORY, 'package.json'))
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error(`${relative(REPOSITORY_ROOT, PACKAGE_DIRECTORY)} must have a public name and version.`)
  }
  const packageSet = await readPublicPackageSet(REPOSITORY_ROOT)
  const expectedDirectory = PUBLIC_PACKAGE_DIRECTORIES[
    manifest.name as keyof typeof PUBLIC_PACKAGE_DIRECTORIES
  ]
  if (expectedDirectory === undefined) {
    throw new Error(`${manifest.name} is not one of the five public Omnidraw packages.`)
  }
  if (resolve(REPOSITORY_ROOT, expectedDirectory) !== PACKAGE_DIRECTORY) {
    throw new Error(`${manifest.name} must be staged from ${expectedDirectory}.`)
  }
  if (packageSet.packages[manifest.name as keyof typeof packageSet.packages] !== manifest.version) {
    throw new Error(`${manifest.name}@${manifest.version} is not the qualified public-package-set version.`)
  }
  if (!await pathExists(DIST_DIRECTORY)) throw new Error(`${manifest.name} build did not create dist/.`)

  const rootManifest = await readJson(join(REPOSITORY_ROOT, 'package.json'))
  const rootCatalog = (rootManifest.catalog ?? {}) as Record<string, string>
  const workspaces = await workspacePackages()
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
    directory: relative(REPOSITORY_ROOT, PACKAGE_DIRECTORY),
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

  await Promise.all([copyDocumentation('LICENSE'), copyDocumentation('README.md')])
  const emittedFiles = await filesBelow(DIST_DIRECTORY)
  await Promise.all(emittedFiles.map(rewriteLocalEsmSpecifiers))

  const manifestText = `${JSON.stringify(publicManifest, null, 2)}\n`
  if (PROTOCOL_PATTERN.test(manifestText) || manifestText.includes(REPOSITORY_ROOT)) {
    throw new Error(`${manifest.name} generated a non-portable public manifest.`)
  }
  await writeFile(join(DIST_DIRECTORY, 'package.json'), manifestText)

  for (const target of exportedTargets(publicManifest.exports)) {
    if (target.includes('*')) continue
    const targetPath = resolve(DIST_DIRECTORY, target)
    if (!targetPath.startsWith(`${DIST_DIRECTORY}${sep}`) || !await pathExists(targetPath)) {
      throw new Error(`${manifest.name} export target does not exist in dist: ${target}`)
    }
  }

  console.log(`[package-dist] ${manifest.name}@${manifest.version} is ready at ${relative(REPOSITORY_ROOT, DIST_DIRECTORY)}`)
}

if (import.meta.main) await main()
