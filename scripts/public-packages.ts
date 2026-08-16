import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

export const PUBLIC_PACKAGE_DIRECTORIES = Object.freeze({
  '@omnidraw/canvas-contract': 'packages/canvas-contract',
  '@omnidraw/canvas': 'packages/canvas',
  '@omnidraw/sdk': 'packages/sdk',
  '@omnidraw/component-ai-chat': 'packages/component-ai-chat',
  '@omnidraw/theme': 'packages/theme',
} as const)

export const PUBLIC_PACKAGE_NAMES = Object.freeze(
  Object.keys(PUBLIC_PACKAGE_DIRECTORIES) as (keyof typeof PUBLIC_PACKAGE_DIRECTORIES)[],
)

export const APPLICATION_DIRECTORIES = Object.freeze([
  'apps/backend',
  'apps/frontend',
] as const)

export const PUBLICATION_ORDER = Object.freeze([
  '@omnidraw/theme',
  '@omnidraw/canvas-contract',
  '@omnidraw/sdk',
  '@omnidraw/canvas',
  '@omnidraw/component-ai-chat',
] as const)

export const EXACT_QUALIFICATION_VERSIONS = Object.freeze({
  effect: '4.0.0-rc.108',
  '@omnidraw/cangine': '0.6.1',
  '@omnidraw/capsule': '0.15.1',
  'solid-js': '1.9.14',
} as const)

export type TPublicPackageManifest = Record<string, unknown> & {
  name: string
  version: string
  private?: boolean
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export type TPublicPackageEntry = Readonly<{
  directory: string
  manifest: TPublicPackageManifest
  name: keyof typeof PUBLIC_PACKAGE_DIRECTORIES
  version: string
}>

export type TPublicPackageSet = Readonly<{
  format: 'omnidraw.public-package-set.v1'
  packages: Readonly<Record<keyof typeof PUBLIC_PACKAGE_DIRECTORIES, string>>
  qualification: Readonly<typeof EXACT_QUALIFICATION_VERSIONS>
  publicationOrder: readonly (keyof typeof PUBLIC_PACKAGE_DIRECTORIES)[]
}>

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
}

function exactKeys(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  const left = [...actual].sort()
  const right = [...expected].sort()
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`${label} must be exactly ${right.join(', ')}; found ${left.join(', ') || '<none>'}.`)
  }
}

export async function readPublicPackageSet(
  repositoryRoot = resolve(import.meta.dir, '..'),
): Promise<TPublicPackageSet> {
  const path = join(repositoryRoot, 'public-package-set.json')
  const value = await readJson(path)
  if (value.format !== 'omnidraw.public-package-set.v1') {
    throw new Error('public-package-set.json has an unsupported format.')
  }
  if (value.packages === null || typeof value.packages !== 'object') {
    throw new Error('public-package-set.json must contain a packages object.')
  }
  if (value.qualification === null || typeof value.qualification !== 'object') {
    throw new Error('public-package-set.json must contain qualification versions.')
  }
  if (!Array.isArray(value.publicationOrder)) {
    throw new Error('public-package-set.json must contain publicationOrder.')
  }

  const packages = value.packages as Record<string, unknown>
  exactKeys(Object.keys(packages), PUBLIC_PACKAGE_NAMES, 'Qualified public packages')
  for (const [name, version] of Object.entries(packages)) {
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error(`${name} has an invalid qualified version.`)
    }
  }

  const qualification = value.qualification as Record<string, unknown>
  exactKeys(
    Object.keys(qualification),
    Object.keys(EXACT_QUALIFICATION_VERSIONS),
    'Qualification dependencies',
  )
  for (const [name, expected] of Object.entries(EXACT_QUALIFICATION_VERSIONS)) {
    if (qualification[name] !== expected) {
      throw new Error(`Qualification version for ${name} must be ${expected}.`)
    }
  }

  exactKeys(
    value.publicationOrder.map(String),
    PUBLICATION_ORDER,
    'Publication order packages',
  )
  if (JSON.stringify(value.publicationOrder) !== JSON.stringify(PUBLICATION_ORDER)) {
    throw new Error(`Publication order must be ${PUBLICATION_ORDER.join(' -> ')}.`)
  }
  return value as unknown as TPublicPackageSet
}

export async function readQualifiedPublicPackages(
  repositoryRoot = resolve(import.meta.dir, '..'),
): Promise<readonly TPublicPackageEntry[]> {
  const packageSet = await readPublicPackageSet(repositoryRoot)
  const entries = await Promise.all(PUBLIC_PACKAGE_NAMES.map(async (name) => {
    const directory = join(repositoryRoot, PUBLIC_PACKAGE_DIRECTORIES[name])
    const manifestPath = join(directory, 'package.json')
    const manifest = await readJson(manifestPath) as TPublicPackageManifest
    if (manifest.name !== name || typeof manifest.version !== 'string' || manifest.private === true) {
      throw new Error(`${relative(repositoryRoot, manifestPath)} has an invalid public identity.`)
    }
    if (manifest.version !== packageSet.packages[name]) {
      throw new Error(
        `${name} is ${manifest.version}; public-package-set.json qualifies ${packageSet.packages[name]}.`,
      )
    }
    return Object.freeze({ directory, manifest, name, version: manifest.version })
  }))
  const byName = new Map(entries.map((entry) => [entry.name, entry]))
  return Object.freeze(PUBLICATION_ORDER.map((name) => byName.get(name)!))
}

async function manifestDirectories(repositoryRoot: string, parent: 'apps' | 'packages'): Promise<string[]> {
  const directory = join(repositoryRoot, parent)
  const children = await readdir(directory, { withFileTypes: true })
  const manifests: string[] = []
  for (const child of children) {
    if (!child.isDirectory()) continue
    const manifest = join(directory, child.name, 'package.json')
    if (await pathExists(manifest)) manifests.push(`${parent}/${child.name}`)
  }
  return manifests.sort()
}

/** Strict final-repository gate. Release commands call this before selecting packages. */
export async function assertFinalWorkspaceSurface(
  repositoryRoot = resolve(import.meta.dir, '..'),
): Promise<void> {
  exactKeys(
    await manifestDirectories(repositoryRoot, 'apps'),
    APPLICATION_DIRECTORIES,
    'Application workspaces',
  )
  exactKeys(
    await manifestDirectories(repositoryRoot, 'packages'),
    Object.values(PUBLIC_PACKAGE_DIRECTORIES),
    'Public package workspaces',
  )

  const rootManifest = await readJson(join(repositoryRoot, 'package.json'))
  const workspaces = rootManifest.workspaces
  if (JSON.stringify(workspaces) !== JSON.stringify(['apps/*', 'packages/*'])) {
    throw new Error('Root workspaces must be exactly apps/* and packages/*.')
  }

  for (const directory of APPLICATION_DIRECTORIES) {
    const manifest = await readJson(join(repositoryRoot, directory, 'package.json'))
    if (manifest.private !== true || manifest.version !== undefined) {
      throw new Error(`${directory} must be private and unversioned.`)
    }
  }
  await readQualifiedPublicPackages(repositoryRoot)
}
