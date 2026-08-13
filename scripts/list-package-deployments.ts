#!/usr/bin/env bun

/** Report which versioned workspace libraries need manual public npm deployment. */

import { readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import {
  assertFinalWorkspaceSurface,
  readQualifiedPublicPackages,
} from './public-packages'

export type TPackageManifest = Record<string, unknown> & {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

export type TWorkspacePackage = Readonly<{
  directory: string
  manifest: TPackageManifest
  name: string
  version: string
}>

export type TRegistryPackage = Readonly<{
  distTags: Readonly<Record<string, string>>
  exists: boolean
  versions: ReadonlySet<string>
}>

export type TPackageDecision = Readonly<{
  action: 'current' | 'deploy' | 'fix-local' | 'fix-tag' | 'bump-dependencies'
  explanation: string
}>

export type TDependencyManifestDrift = Readonly<{
  dependency: string
  distSpecifier?: string
  field: 'dependencies' | 'optionalDependencies' | 'peerDependencies'
  publishedSpecifier?: string
}>

export type TPackageBuilder = (
  entry: TWorkspacePackage,
  index: number,
  total: number,
) => Promise<void>

const REPOSITORY_ROOT = resolve(import.meta.dir, '..')
const PUBLIC_REGISTRY = 'https://registry.npmjs.org'
const ANSI = Object.freeze({
  bold: '\u001b[1m',
  cyan: '\u001b[36m',
  dim: '\u001b[2m',
  green: '\u001b[32m',
  red: '\u001b[31m',
  reset: '\u001b[0m',
  yellow: '\u001b[33m',
})

type TColor = keyof Omit<typeof ANSI, 'reset'>

function colorEnabled(): boolean {
  return process.stdout.isTTY === true && process.env.NO_COLOR === undefined
}

function paint(value: string, color: TColor): string {
  return colorEnabled() ? `${ANSI[color]}${value}${ANSI.reset}` : value
}

function printHeading(value: string): void {
  console.log(paint(value, 'bold'))
}

function printPackageGroup(
  title: string,
  entries: readonly Readonly<{
    entry: TWorkspacePackage
    explanation?: string
  }>[],
  color: TColor,
  symbol: string,
): void {
  if (entries.length === 0) return
  console.log('')
  console.log(paint(`${title} (${entries.length})`, color))
  for (const { entry, explanation } of entries) {
    console.log(`  ${paint(symbol, color)} ${entry.name}@${entry.version}`)
    if (explanation !== undefined) console.log(`    ${paint(explanation, 'dim')}`)
  }
}

function dependencyNames(manifest: TPackageManifest): readonly string[] {
  return ['dependencies', 'optionalDependencies', 'peerDependencies']
    .flatMap((field) => Object.keys((manifest[field] ?? {}) as Record<string, string>))
}

export function packageOrder(packages: readonly TWorkspacePackage[]): readonly TWorkspacePackage[] {
  const names = new Set(packages.map((entry) => entry.name))
  const remaining = new Map(packages.map((entry) => [entry.name, entry]))
  const ordered: TWorkspacePackage[] = []
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((entry) => dependencyNames(entry.manifest)
      .filter((dependency) => names.has(dependency))
      .every((dependency) => !remaining.has(dependency)))
    if (ready.length === 0) {
      throw new Error(`Versioned package dependency cycle: ${[...remaining.keys()].join(', ')}`)
    }
    ready.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of ready) {
      remaining.delete(entry.name)
      ordered.push(entry)
    }
  }
  return ordered
}

export async function buildPackages(
  packages: readonly TWorkspacePackage[],
  builder: TPackageBuilder,
): Promise<void> {
  for (const [index, entry] of packages.entries()) {
    await builder(entry, index, packages.length)
  }
}

async function buildWorkspacePackage(
  entry: TWorkspacePackage,
  index: number,
  total: number,
): Promise<void> {
  console.log(`${paint(`[${index + 1}/${total}]`, 'cyan')} ${entry.name}@${entry.version}`)
  const child = Bun.spawn(['bun', 'run', 'build'], {
    cwd: entry.directory,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await child.exited
  if (exitCode !== 0) {
    throw new Error(`Build failed for ${entry.name}@${entry.version} with exit code ${exitCode}.`)
  }
}

function releaseTag(version: string): string {
  const prerelease = version.split('-', 2)[1]
  if (prerelease === undefined) return 'latest'
  const label = prerelease.split('.')[0]
  return label === 'beta' || label === 'nightly' ? label : 'next'
}

function nextPatchVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (match === null) throw new Error(`Cannot suggest the next patch version after ${version}.`)
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

export function packageDecision(
  entry: Pick<TWorkspacePackage, 'name' | 'version'>,
  registry: TRegistryPackage,
  dependencyDrift: readonly TDependencyManifestDrift[] = [],
): TPackageDecision {
  const localExists = registry.versions.has(entry.version)
  const tag = releaseTag(entry.version)
  const taggedVersion = registry.distTags[tag]
  const latest = registry.distTags.latest

  if (!registry.exists) {
    return {
      action: 'deploy',
      explanation: `public npm returned 404; publish ${entry.name}@${entry.version} with tag ${tag}`,
    }
  }
  if (localExists && dependencyDrift.length > 0) {
    const differences = dependencyDrift.map((drift) => {
      if (drift.publishedSpecifier === undefined) {
        return `npm has no ${drift.dependency}, but the new build uses ${drift.dependency}@${drift.distSpecifier}`
      }
      if (drift.distSpecifier === undefined) {
        return `npm uses ${drift.dependency}@${drift.publishedSpecifier}, but the new build removes it`
      }
      return `npm uses ${drift.dependency}@${drift.publishedSpecifier}, but the new build uses ${drift.dependency}@${drift.distSpecifier}`
    })
    return {
      action: 'bump-dependencies',
      explanation: `catalog mismatch: ${differences.join('; ')}. With approval, update ${entry.name} to ${nextPatchVersion(entry.version)} and build again.`,
    }
  }
  if (localExists && taggedVersion === entry.version) {
    return {
      action: 'current',
      explanation: `${tag} and the local manifest are both ${entry.version}`,
    }
  }
  if (localExists) {
    if (taggedVersion !== undefined && Bun.semver.order(entry.version, taggedVersion) < 0) {
      return {
        action: 'fix-local',
        explanation: `${tag} is ${taggedVersion}, newer than the existing local ${entry.version}; update the local version above ${taggedVersion} instead of moving the tag backwards`,
      }
    }
    return {
      action: 'fix-tag',
      explanation: `${entry.name}@${entry.version} already exists, but ${tag} points to ${taggedVersion ?? 'nothing'}; do not republish`,
    }
  }
  if (latest === undefined) {
    return {
      action: 'deploy',
      explanation: `the package exists without a latest tag and local ${entry.version} is unpublished`,
    }
  }

  const comparison = Bun.semver.order(entry.version, latest)
  if (comparison > 0) {
    return {
      action: 'deploy',
      explanation: `public latest is ${latest}; local ${entry.version} is newer and unpublished`,
    }
  }
  if (comparison < 0) {
    return {
      action: 'fix-local',
      explanation: `public latest is ${latest}, newer than local ${entry.version}; update the local package version above ${latest} and rebuild dependents`,
    }
  }
  return {
    action: 'fix-local',
    explanation: `public latest claims ${latest}, but that exact version is absent from the registry version list; inspect npm before continuing`,
  }
}

export function dependencyManifestDrift(
  distManifest: TPackageManifest,
  publishedManifest: TPackageManifest,
): readonly TDependencyManifestDrift[] {
  const drift: TDependencyManifestDrift[] = []
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    const distDependencies = distManifest[field] ?? {}
    const publishedDependencies = publishedManifest[field] ?? {}
    const names = new Set([...Object.keys(distDependencies), ...Object.keys(publishedDependencies)])
    for (const dependency of [...names].sort()) {
      const distSpecifier = distDependencies[dependency]
      const publishedSpecifier = publishedDependencies[dependency]
      if (distSpecifier === publishedSpecifier) continue
      drift.push({ dependency, distSpecifier, field, publishedSpecifier })
    }
  }
  return drift
}

async function workspacePackages(): Promise<readonly TWorkspacePackage[]> {
  await assertFinalWorkspaceSurface(REPOSITORY_ROOT)
  const packages = (await readQualifiedPublicPackages(REPOSITORY_ROOT)).map((entry) => ({
    directory: entry.directory,
    manifest: entry.manifest,
    name: entry.name,
    version: entry.version,
  }))
  return packageOrder(packages)
}

async function registryPackage(name: string): Promise<TRegistryPackage> {
  const response = await fetch(`${PUBLIC_REGISTRY}/${encodeURIComponent(name)}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
    redirect: 'error',
  })
  if (response.status === 404) {
    return { distTags: {}, exists: false, versions: new Set() }
  }
  if (!response.ok) {
    throw new Error(`Public npm check failed for ${name}: HTTP ${response.status} ${response.statusText}`)
  }
  const body = await response.json() as {
    'dist-tags'?: Record<string, string>
    versions?: Record<string, unknown>
  }
  return {
    distTags: Object.freeze({ ...(body['dist-tags'] ?? {}) }),
    exists: true,
    versions: new Set(Object.keys(body.versions ?? {})),
  }
}

async function registryManifest(name: string, version: string): Promise<TPackageManifest> {
  const response = await fetch(
    `${PUBLIC_REGISTRY}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    { headers: { accept: 'application/json' }, redirect: 'error' },
  )
  if (!response.ok) {
    throw new Error(
      `Public npm manifest check failed for ${name}@${version}: HTTP ${response.status} ${response.statusText}`,
    )
  }
  const manifest = await response.json() as TPackageManifest
  if (manifest.name !== name || manifest.version !== version) {
    throw new Error(`Public npm returned an invalid manifest for ${name}@${version}.`)
  }
  return manifest
}

async function distManifest(entry: TWorkspacePackage): Promise<TPackageManifest> {
  const manifest = JSON.parse(
    await readFile(join(entry.directory, 'dist', 'package.json'), 'utf8'),
  ) as TPackageManifest
  if (manifest.name !== entry.name || manifest.version !== entry.version) {
    throw new Error(`${entry.name} dist/package.json does not match ${entry.name}@${entry.version}.`)
  }
  return manifest
}

function resolvedDependencyVersion(
  dependency: string,
  specifier: string,
  catalog: Readonly<Record<string, string>>,
): string | null {
  if (specifier === 'catalog:' || specifier.startsWith('catalog:')) return catalog[dependency] ?? null
  if (specifier.startsWith('workspace:')) return null
  return specifier
}

function exactSemanticVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export function publishCommand(entry: TWorkspacePackage): string {
  const tag = releaseTag(entry.version)
  const registryArguments = [
    `--registry=${PUBLIC_REGISTRY}/`,
    shellQuote(`--@omnidraw:registry=${PUBLIC_REGISTRY}/`),
  ].join(' ')
  return [
    `echo ${shellQuote(`Publishing ${entry.name}@${entry.version}`)}`,
    `cd ${shellQuote(relative(REPOSITORY_ROOT, entry.directory))}`,
    'bun run build',
    `npm publish ./dist --dry-run --access public --tag ${tag} --provenance=false ${registryArguments}`,
    `npm publish ./dist --access public --tag ${tag} --provenance=false ${registryArguments}`,
  ].join(' && ')
}

function tagCommand(entry: TWorkspacePackage): string {
  return `npm dist-tag add ${entry.name}@${entry.version} ${releaseTag(entry.version)} --registry=${PUBLIC_REGISTRY}/`
}

async function main(): Promise<void> {
  const packages = await workspacePackages()
  if (packages.length === 0) throw new Error('No versioned packages were found under packages/.')

  console.log('')
  printHeading('BUILDING VERSIONED PACKAGES')
  console.log(paint('Fresh dist artifacts are required before checking public deployment status.', 'dim'))
  console.log('')
  await buildPackages(packages, buildWorkspacePackage)
  console.log('')
  console.log(paint(`✓ Built ${packages.length} packages in dependency order.`, 'green'))

  const rootManifest = JSON.parse(await readFile(join(REPOSITORY_ROOT, 'package.json'), 'utf8')) as {
    catalog?: Record<string, string>
  }
  const catalog = rootManifest.catalog ?? {}
  const localByName = new Map(packages.map((entry) => [entry.name, entry]))

  const externalRequirements = new Map<string, string>()
  for (const entry of packages) {
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
      for (const [dependency, specifier] of Object.entries(entry.manifest[field] ?? {})) {
        if (localByName.has(dependency) || !dependency.startsWith('@omnidraw/')) continue
        const version = resolvedDependencyVersion(dependency, specifier, catalog)
        if (version !== null && exactSemanticVersion(version)) {
          externalRequirements.set(dependency, version)
        }
      }
    }
  }

  const registryNames = [...new Set([...packages.map((entry) => entry.name), ...externalRequirements.keys()])]
  const registryEntries = await Promise.all(registryNames.map(async (name) => [
    name,
    await registryPackage(name),
  ] as const))
  const registry = new Map(registryEntries)
  const existingPackages = packages.filter((entry) => registry.get(entry.name)!.versions.has(entry.version))
  const manifestComparisons = new Map(await Promise.all(existingPackages.map(async (entry) => {
    const [dist, published] = await Promise.all([
      distManifest(entry),
      registryManifest(entry.name, entry.version),
    ])
    return [entry.name, dependencyManifestDrift(dist, published)] as const
  })))
  const decisions = new Map(packages.map((entry) => [
    entry.name,
    packageDecision(entry, registry.get(entry.name)!, manifestComparisons.get(entry.name)),
  ]))

  const missingExternal = [...externalRequirements].filter(([dependency, version]) => (
    !registry.get(dependency)!.versions.has(version)
  ))

  const available = new Set(packages.filter((entry) => registry.get(entry.name)!.versions.has(entry.version))
    .map((entry) => entry.name))
  const deployable: TWorkspacePackage[] = []
  const blockedDeployments: Readonly<{ entry: TWorkspacePackage; blockers: readonly string[] }>[] = []
  for (const entry of packages) {
    if (decisions.get(entry.name)!.action !== 'deploy') continue
    const blockers: string[] = []
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
      for (const [dependency, specifier] of Object.entries(entry.manifest[field] ?? {})) {
        const internal = localByName.get(dependency)
        if (internal !== undefined && !available.has(dependency)) {
          blockers.push(`${dependency}@${internal.version}`)
          continue
        }
        if (internal === undefined && dependency.startsWith('@omnidraw/')) {
          const version = resolvedDependencyVersion(dependency, specifier, catalog)
          if (version !== null && !registry.get(dependency)?.versions.has(version)) {
            blockers.push(`${dependency}@${version}`)
          }
        }
      }
    }
    if (blockers.length > 0) {
      blockedDeployments.push({ entry, blockers: [...new Set(blockers)] })
      continue
    }
    deployable.push(entry)
    available.add(entry.name)
  }

  const tagFixes = packages.filter((entry) => decisions.get(entry.name)!.action === 'fix-tag')
  const localFixes = packages.filter((entry) => decisions.get(entry.name)!.action === 'fix-local')
  const dependencyBumps = packages.filter((entry) => (
    decisions.get(entry.name)!.action === 'bump-dependencies'
  ))
  const current = packages.filter((entry) => decisions.get(entry.name)!.action === 'current')

  console.log('')
  printHeading('OMNIDRAW PACKAGE DEPLOYMENTS')
  console.log(paint(`Registry  ${PUBLIC_REGISTRY}`, 'dim'))
  console.log(paint(`${packages.length} versioned libraries · apps and unversioned workspaces excluded`, 'dim'))

  console.log('')
  printHeading('SUMMARY')
  console.log([
    paint(`${current.length} current`, 'green'),
    paint(`${deployable.length} ready`, 'cyan'),
    paint(`${blockedDeployments.length} waiting`, 'yellow'),
    paint(`${localFixes.length + dependencyBumps.length + tagFixes.length} need attention`, 'red'),
  ].join(paint('  ·  ', 'dim')))

  printPackageGroup('CURRENT', current.map((entry) => ({ entry })), 'green', '✓')
  printPackageGroup('READY TO DEPLOY', deployable.map((entry) => ({
    entry,
    explanation: decisions.get(entry.name)!.explanation,
  })), 'cyan', '↑')
  printPackageGroup('WAITING', blockedDeployments.map(({ entry, blockers }) => ({
    entry,
    explanation: `Requires ${blockers.join(', ')}`,
  })), 'yellow', '◷')
  printPackageGroup('BLOCKED — FIX LOCAL VERSION', localFixes.map((entry) => ({
    entry,
    explanation: decisions.get(entry.name)!.explanation,
  })), 'red', '×')
  printPackageGroup('BLOCKED — CATALOG MISMATCH', dependencyBumps.map((entry) => ({
    entry,
    explanation: decisions.get(entry.name)!.explanation,
  })), 'red', '×')
  printPackageGroup('NEEDS DIST-TAG DECISION', tagFixes.map((entry) => ({
    entry,
    explanation: decisions.get(entry.name)!.explanation,
  })), 'yellow', '!')

  if (missingExternal.length > 0) {
    console.log('')
    console.log(paint(`MISSING PUBLIC PREREQUISITES (${missingExternal.length})`, 'yellow'))
    for (const [dependency, version] of missingExternal) {
      console.log(`  ${paint('!', 'yellow')} ${dependency}@${version}`)
      console.log(`    ${paint('Publish it from its owning repository, then rerun this command.', 'dim')}`)
    }
  }

  if (tagFixes.length > 0) {
    console.log('')
    printHeading('DIST-TAG COMMANDS')
    for (const entry of tagFixes) console.log(`  ${tagCommand(entry)}`)
  }

  if (deployable.length === 0) {
    console.log('')
    console.log(paint('Nothing is currently safe and necessary to deploy.', 'dim'))
  } else {
    console.log('')
    printHeading('DEPLOY COMMANDS — DEPENDENCY ORDER')
    deployable.forEach((entry, index) => {
      console.log('')
      console.log(paint(`${index + 1}. ${entry.name}@${entry.version}`, 'cyan'))
      console.log(publishCommand(entry))
    })
  }

  console.log('')

  const blocked = packages.some((entry) => decisions.get(entry.name)!.action === 'fix-local')
    || dependencyBumps.length > 0
    || missingExternal.length > 0
    || blockedDeployments.length > 0
  if (blocked) process.exitCode = 2
}

if (import.meta.main) await main()
