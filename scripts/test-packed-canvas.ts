#!/usr/bin/env bun

/**
 * Packs the public browser packages and proves a clean external consumer.
 */

import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, posix, relative, resolve } from 'node:path'

type TPublicPackage = Readonly<{
  name: string
  directory: string
}>

type TCommandResult = Readonly<{
  stderr: string
  stdout: string
}>

type TPackedPackage = Readonly<{
  entry: TPublicPackage
  manifest: Record<string, unknown>
  tarball: string
}>

const REPOSITORY_ROOT = resolve(import.meta.dir, '..')
const FIXTURE_ROOT = join(REPOSITORY_ROOT, 'tests/fixtures/canvas-consumer')
const PUBLIC_PACKAGES: readonly TPublicPackage[] = Object.freeze([
  { name: '@omnidraw/theme', directory: 'packages/theme' },
  { name: '@omnidraw/canvas-contract', directory: 'packages/canvas-contract' },
  { name: '@omnidraw/canvas', directory: 'packages/canvas' },
  { name: '@omnidraw/component-ai-chat', directory: 'packages/component-ai-chat' },
])
const ALLOWED_INSTALLED_OMNIDRAW_PACKAGES = new Set([
  'cangine',
  'canvas',
  'canvas-contract',
  'component-ai-chat',
  'theme',
])
const ALLOWED_PUBLIC_OMNIDRAW_NAMES = new Set(
  PUBLIC_PACKAGES.map((entry) => entry.name).concat('@omnidraw/cangine'),
)
const TEXT_ARCHIVE_EXTENSION = /\.(?:css|d\.ts|html|js|json|map|md|txt)$/
const MODULE_ARCHIVE_EXTENSION = /\.(?:d\.ts|js)$/

async function runCommand(
  command: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<TCommandResult> {
  const child = Bun.spawn([...command], {
    cwd,
    env,
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
    throw new Error([
      `Command failed (${exitCode}): ${command.join(' ')}`,
      stdout.trim(),
      stderr.trim(),
    ].filter(Boolean).join('\n'))
  }
  return { stdout, stderr }
}

function exportedTargets(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(exportedTargets)
  if (value === null || typeof value !== 'object') return []
  return Object.values(value).flatMap(exportedTargets)
}

function moduleSpecifiers(source: string): readonly string[] {
  const declarations = source.matchAll(
    /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^;'"`]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  )
  const dynamicImports = source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)
  return [
    ...[...declarations].map((match) => match[1]!),
    ...[...dynamicImports].map((match) => match[1]!),
  ]
}

function importedPackageName(specifier: string): string | null {
  if (
    specifier.startsWith('.')
    || specifier.startsWith('/')
    || specifier.startsWith('#')
    || /^(?:bun|data|node):/.test(specifier)
  ) return null
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0] ?? null
}

async function archiveEntries(tarball: string): Promise<readonly string[]> {
  const result = await runCommand(['tar', '-tzf', tarball], REPOSITORY_ROOT)
  return result.stdout.split('\n').map((entry) => entry.trim()).filter(Boolean)
}

async function archiveText(tarball: string, path: string): Promise<string> {
  return (await runCommand(['tar', '-xOf', tarball, path], REPOSITORY_ROOT)).stdout
}

async function packedManifest(tarball: string): Promise<Record<string, unknown>> {
  return JSON.parse(await archiveText(tarball, 'package/package.json')) as Record<string, unknown>
}

function declaredRuntimePackages(manifest: Record<string, unknown>): ReadonlySet<string> {
  const declared = new Set<string>()
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    for (const dependency of Object.keys((manifest[field] ?? {}) as Record<string, unknown>)) {
      declared.add(dependency)
    }
  }
  return declared
}

async function assertPackedPackage(
  entry: TPublicPackage,
  tarball: string,
  expectedVersion: string,
): Promise<Record<string, unknown>> {
  const manifest = await packedManifest(tarball)
  if (manifest.name !== entry.name || manifest.version !== expectedVersion || manifest.private === true) {
    throw new Error(`${entry.name} packed with an invalid public identity.`)
  }
  const manifestText = JSON.stringify(manifest)
  if (/(?:workspace|catalog|file|link):/.test(manifestText)) {
    throw new Error(`${entry.name} retained a workspace-only dependency protocol.`)
  }

  const entries = await archiveEntries(tarball)
  const entrySet = new Set(entries)
  for (const target of exportedTargets(manifest.exports)) {
    const archiveTarget = `package/${target.replace(/^\.\//, '')}`
    if (!entrySet.has(archiveTarget)) {
      throw new Error(`${entry.name} export target is absent from its tarball: ${target}`)
    }
  }
  const sourceModules = entries.filter((path) => (
    path.startsWith('package/src/')
    && ['.js', '.jsx', '.ts', '.tsx'].includes(extname(path))
    && !path.endsWith('.d.ts')
  ))
  if (sourceModules.length > 0) {
    throw new Error(`${entry.name} packed workspace source:\n${sourceModules.join('\n')}`)
  }

  const declared = declaredRuntimePackages(manifest)
  const violations: string[] = []
  for (const path of entries.filter((candidate) => TEXT_ARCHIVE_EXTENSION.test(candidate))) {
    const source = await archiveText(tarball, path)
    if (source.includes(REPOSITORY_ROOT)) violations.push(`${path}: absolute repository path`)
    if (/['"](?:workspace|catalog):/.test(source)) violations.push(`${path}: workspace protocol`)
    if (path.endsWith('.d.ts') && /(?:\.\.\/)+(?:apps|packages)\//.test(source)) {
      violations.push(`${path}: repository-relative declaration reference`)
    }
    if (MODULE_ARCHIVE_EXTENSION.test(path)) {
      for (const specifier of moduleSpecifiers(source)) {
        if (specifier.startsWith('.') && specifier.endsWith('.css')) {
          const target = posix.normalize(posix.join(posix.dirname(path), specifier))
          if (!entrySet.has(target)) violations.push(`${path}: missing stylesheet import ${specifier}`)
          continue
        }
        const dependency = importedPackageName(specifier)
        if (dependency?.startsWith('@omnidraw/') && !ALLOWED_PUBLIC_OMNIDRAW_NAMES.has(dependency)) {
          violations.push(`${path}: private Omnidraw dependency ${dependency}`)
        }
        if (dependency && dependency !== entry.name && !declared.has(dependency)) {
          violations.push(`${path}: undeclared ${dependency} via ${specifier}`)
        }
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(`${entry.name} tarball boundary violations:\n${violations.join('\n')}`)
  }

  if (entry.name === '@omnidraw/canvas') {
    const cssPath = 'package/styles.css'
    const css = await archiveText(tarball, cssPath)
    const assetUrls = [...css.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g)]
      .map((match) => match[2]!)
      .filter((url) => !/^(?:data:|https?:)/.test(url))
    if (assetUrls.length === 0 || !assetUrls.some((url) => /\.(?:ttf|woff2?)$/.test(url))) {
      throw new Error('Canvas CSS does not reference a packaged font asset.')
    }
    for (const url of assetUrls) {
      if (url.startsWith('/')) throw new Error(`Canvas CSS retained root-relative asset URL ${url}.`)
      const resolvedAsset = posix.normalize(posix.join(posix.dirname(cssPath), url))
      if (!entrySet.has(resolvedAsset)) {
        throw new Error(`Canvas CSS references missing packed asset ${url}.`)
      }
    }
  }
  return manifest
}

async function buildAndPack(
  entry: TPublicPackage,
  packRoot: string,
): Promise<TPackedPackage> {
  const packageRoot = join(REPOSITORY_ROOT, entry.directory)
  await runCommand([process.execPath, 'run', 'build'], packageRoot)
  const releaseRoot = join(packageRoot, 'dist')
  const expectedVersion = (JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
    version?: string
  }).version
  if (expectedVersion === undefined) throw new Error(`${entry.name} has no release version.`)
  const result = await runCommand(
    [process.execPath, 'pm', 'pack', '--destination', packRoot, '--quiet'],
    releaseRoot,
  )
  const outputPath = result.stdout.trim().split('\n').filter(Boolean).at(-1)
  if (!outputPath) throw new Error(`${entry.name} pack did not report a tarball.`)
  const tarball = resolve(releaseRoot, outputPath)
  if (dirname(tarball) !== packRoot) throw new Error(`${entry.name} pack escaped its isolated directory.`)
  const manifest = await assertPackedPackage(entry, tarball, expectedVersion)
  return Object.freeze({ entry, manifest, tarball })
}

async function packInstalledCangine(packRoot: string): Promise<string> {
  const entry: TPublicPackage = {
    name: '@omnidraw/cangine',
    directory: 'node_modules/@omnidraw/cangine',
  }
  const packageRoot = await realpath(join(REPOSITORY_ROOT, entry.directory))
  const result = await runCommand(
    [process.execPath, 'pm', 'pack', '--destination', packRoot, '--quiet'],
    packageRoot,
  )
  const outputPath = result.stdout.trim().split('\n').filter(Boolean).at(-1)
  if (!outputPath) throw new Error('@omnidraw/cangine pack did not report a tarball.')
  const tarball = resolve(packageRoot, outputPath)
  if (dirname(tarball) !== packRoot) throw new Error('@omnidraw/cangine pack escaped its isolated directory.')
  await assertPackedPackage(entry, tarball, '0.6.1')
  return tarball
}

async function assertInstalledPackages(consumerRoot: string): Promise<void> {
  const canonicalConsumerRoot = await realpath(consumerRoot)
  for (const entry of PUBLIC_PACKAGES) {
    const expectedVersion = (JSON.parse(await readFile(
      join(REPOSITORY_ROOT, entry.directory, 'package.json'),
      'utf8',
    )) as { version?: string }).version
    const installedRoot = await realpath(join(consumerRoot, 'node_modules', ...entry.name.split('/')))
    if (
      relative(canonicalConsumerRoot, installedRoot).startsWith('..')
      || installedRoot.startsWith(`${REPOSITORY_ROOT}/`)
    ) {
      throw new Error(`${entry.name} did not resolve from the isolated consumer: ${installedRoot}`)
    }
    const manifest = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8')) as {
      name?: string
      version?: string
    }
    if (manifest.name !== entry.name || manifest.version !== expectedVersion) {
      throw new Error(`${entry.name} installed with an unexpected identity.`)
    }
  }

  const installedScope = new Set(await readdir(join(consumerRoot, 'node_modules/@omnidraw')))
  for (const packageName of installedScope) {
    if (!ALLOWED_INSTALLED_OMNIDRAW_PACKAGES.has(packageName)) {
      throw new Error(`Clean canvas consumer installed private @omnidraw/${packageName}.`)
    }
  }
  for (const packageName of ALLOWED_INSTALLED_OMNIDRAW_PACKAGES) {
    if (!installedScope.has(packageName)) throw new Error(`Clean canvas consumer is missing @omnidraw/${packageName}.`)
  }

  const hostSolid = await realpath(join(consumerRoot, 'node_modules/solid-js'))
  for (const packageName of ['canvas', 'component-ai-chat']) {
    const nestedSolid = join(consumerRoot, 'node_modules/@omnidraw', packageName, 'node_modules/solid-js')
    try {
      const nested = await realpath(nestedSolid)
      if (nested !== hostSolid) throw new Error(`${packageName} installed a duplicate Solid runtime: ${nested}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

async function assertFixtureIsStandalone(): Promise<Record<string, unknown>> {
  const manifestText = await readFile(join(FIXTURE_ROOT, 'package.json'), 'utf8')
  if (/(?:workspace|catalog|file|link):/.test(manifestText)) {
    throw new Error('Canvas fixture manifest contains a workspace/path protocol.')
  }
  const tsconfig = JSON.parse(await readFile(join(FIXTURE_ROOT, 'tsconfig.json'), 'utf8')) as {
    extends?: unknown
    compilerOptions?: { paths?: unknown }
  }
  if (tsconfig.extends !== undefined || tsconfig.compilerOptions?.paths !== undefined) {
    throw new Error('Canvas fixture depends on the repository TypeScript configuration.')
  }
  return JSON.parse(manifestText) as Record<string, unknown>
}

async function main(): Promise<void> {
  const fixtureManifest = await assertFixtureIsStandalone()
  const testRoot = await mkdtemp(join(tmpdir(), 'omnidraw-packed-canvas-'))
  const packRoot = join(testRoot, 'packs')
  const consumerRoot = join(testRoot, 'consumer')
  const installCache = join(testRoot, 'install-cache')
  await Promise.all([
    mkdir(packRoot, { recursive: true }),
    mkdir(consumerRoot, { recursive: true }),
    mkdir(installCache, { recursive: true }),
  ])

  try {
    const packed: TPackedPackage[] = []
    for (const entry of PUBLIC_PACKAGES) packed.push(await buildAndPack(entry, packRoot))
    const cangineTarball = await packInstalledCangine(packRoot)
    await cp(FIXTURE_ROOT, consumerRoot, { recursive: true })

    const tarballDependencies = {
      ...Object.fromEntries(packed.map(({ entry, tarball }) => [
        entry.name,
        `file:${tarball}`,
      ])),
      '@omnidraw/cangine': `file:${cangineTarball}`,
    }
    const dependencies = {
      ...(fixtureManifest.dependencies as Record<string, string>),
      ...tarballDependencies,
    }
    await writeFile(join(consumerRoot, 'package.json'), `${JSON.stringify({
      ...fixtureManifest,
      dependencies,
      overrides: tarballDependencies,
    }, null, 2)}\n`)

    const installEnvironment = {
      ...process.env,
      BUN_INSTALL_CACHE_DIR: installCache,
      CI: process.env.CI ?? '1',
    }
    await runCommand(
      [process.execPath, 'install', '--ignore-scripts', '--lockfile-only'],
      consumerRoot,
      installEnvironment,
    )
    await runCommand(
      [process.execPath, 'install', '--ignore-scripts', '--frozen-lockfile'],
      consumerRoot,
      installEnvironment,
    )
    await assertInstalledPackages(consumerRoot)

    const lockText = await readFile(join(consumerRoot, 'bun.lock'), 'utf8')
    if (lockText.includes(REPOSITORY_ROOT) || lockText.includes('workspace:') || lockText.includes('catalog:')) {
      throw new Error('Clean canvas consumer lockfile retained repository/workspace resolution.')
    }
    for (const installedName of lockText.matchAll(/@omnidraw\/([a-z0-9-]+)/g)) {
      if (!ALLOWED_INSTALLED_OMNIDRAW_PACKAGES.has(installedName[1]!)) {
        throw new Error(`Clean consumer lockfile includes private @omnidraw/${installedName[1]}.`)
      }
    }

    const typescriptBin = join(consumerRoot, 'node_modules/typescript/bin/tsc')
    await runCommand([process.execPath, typescriptBin, '--noEmit', '-p', 'tsconfig.json'], consumerRoot)
    const tests = await runCommand([process.execPath, 'test', 'transport.test.ts'], consumerRoot)
    await runCommand([process.execPath, 'run', 'build'], consumerRoot)
    const builtFiles = await readdir(join(consumerRoot, 'dist'))
    if (!builtFiles.includes('index.html')) throw new Error('Clean consumer production build is incomplete.')
    const browserSmoke = await runCommand(
      [process.execPath, 'run', 'src/browser-smoke.ts'],
      consumerRoot,
      installEnvironment,
    )
    if (!`${tests.stdout}\n${tests.stderr}`.match(/\b2 pass\b/)) {
      throw new Error('Canvas transport fixture did not report two passing tests.')
    }
    if (!browserSmoke.stdout.includes('browser smokes passed')) {
      throw new Error('Canvas browser consumer did not report both passing compositions.')
    }

    console.log(
      `[packed-canvas] packed ${packed.map(({ entry, manifest }) => `${entry.name}@${manifest.version}`).join(', ')}; clean install, one Solid runtime, typecheck, 2 transport tests, production build, and 2 browser smokes passed`,
    )
  } finally {
    await rm(testRoot, { recursive: true, force: true })
  }
}

await main()
