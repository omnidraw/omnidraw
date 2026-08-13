#!/usr/bin/env bun

/**
 * @file Packs the five managed-composition packages and proves a clean external consumer.
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
import { dirname, join, relative, resolve } from 'node:path'

type TPublicPackage = Readonly<{
  name: string
  directory: string
}>

type TCommandResult = Readonly<{
  stdout: string
  stderr: string
}>

const REPOSITORY_ROOT = resolve(import.meta.dir, '..')
const FIXTURE_ROOT = join(REPOSITORY_ROOT, 'tests', 'fixtures', 'external-composition')
const PUBLIC_PACKAGES: readonly TPublicPackage[] = Object.freeze([
  { name: '@omnidraw/theme', directory: 'packages/theme' },
  { name: '@omnidraw/canvas-contract', directory: 'packages/canvas-contract' },
  { name: '@omnidraw/sdk', directory: 'packages/sdk' },
  { name: '@omnidraw/canvas', directory: 'packages/canvas' },
  { name: '@omnidraw/component-ai-chat', directory: 'packages/component-ai-chat' },
])
const SOURCE_MODULE_EXTENSION = /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/

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

async function packedManifest(tarball: string): Promise<Record<string, unknown>> {
  const result = await runCommand(['tar', '-xOf', tarball, 'package/package.json'], REPOSITORY_ROOT)
  return JSON.parse(result.stdout) as Record<string, unknown>
}

function moduleSpecifiers(source: string): readonly string[] {
  const declarations = source.matchAll(
    /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^;'"`]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  )
  const dynamicImports = source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)
  const commonJsRequires = source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)
  return [
    ...[...declarations].map((match) => match[1]!),
    ...[...dynamicImports].map((match) => match[1]!),
    ...[...commonJsRequires].map((match) => match[1]!),
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

async function assertPackedSourceDependencies(
  tarball: string,
  manifest: Record<string, unknown>,
  packageName: string,
): Promise<void> {
  const declared = new Set<string>()
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    for (const dependency of Object.keys((manifest[field] ?? {}) as Record<string, unknown>)) {
      declared.add(dependency)
    }
  }
  const archive = await runCommand(['tar', '-tzf', tarball], REPOSITORY_ROOT)
  const sourceFiles = archive.stdout.split('\n').filter((entry) => (
    entry.startsWith('package/src/') && SOURCE_MODULE_EXTENSION.test(entry)
  ))
  const missing = new Set<string>()
  for (const sourceFile of sourceFiles) {
    const source = (await runCommand(['tar', '-xOf', tarball, sourceFile], REPOSITORY_ROOT)).stdout
    for (const specifier of moduleSpecifiers(source)) {
      const dependency = importedPackageName(specifier)
      if (dependency && dependency !== packageName && !declared.has(dependency)) {
        missing.add(`${sourceFile} imports undeclared ${dependency} via ${specifier}`)
      }
    }
  }
  if (missing.size > 0) {
    throw new Error(`${packageName} packed source is not dependency-self-describing:\n${[...missing].join('\n')}`)
  }
}

function exactInternalDependencies(
  manifest: Record<string, unknown>,
  packageName: string,
  versions: ReadonlyMap<string, string>,
): void {
  const dependencies = manifest.dependencies === undefined
    ? {}
    : manifest.dependencies as Record<string, unknown>
  for (const [dependency, version] of Object.entries(dependencies)) {
    const expectedVersion = versions.get(dependency)
    if (expectedVersion !== undefined && version !== expectedVersion) {
      throw new Error(`${packageName} does not pin ${dependency} to ${expectedVersion}.`)
    }
  }
  const text = JSON.stringify(manifest)
  if (text.includes('workspace:') || text.includes('catalog:')) {
    throw new Error(`${packageName} retained a workspace-only dependency protocol after packing.`)
  }
}

async function packPublicPackage(
  entry: TPublicPackage,
  packRoot: string,
  versions: ReadonlyMap<string, string>,
): Promise<Readonly<{ entry: TPublicPackage; tarball: string }>> {
  const packageRoot = join(REPOSITORY_ROOT, entry.directory)
  await runCommand([process.execPath, 'run', 'build'], packageRoot)
  const releaseRoot = join(packageRoot, 'dist')
  const result = await runCommand(
    [process.execPath, 'pm', 'pack', '--destination', packRoot, '--quiet'],
    releaseRoot,
  )
  const outputPath = result.stdout.trim().split('\n').filter(Boolean).at(-1)
  if (!outputPath) throw new Error(`${entry.name} pack command did not report a tarball.`)
  const tarball = resolve(releaseRoot, outputPath)
  if (dirname(tarball) !== packRoot) {
    throw new Error(`${entry.name} pack command escaped the isolated pack directory.`)
  }
  const manifest = await packedManifest(tarball)
  if (manifest.name !== entry.name || manifest.version !== versions.get(entry.name)) {
    throw new Error(`${entry.name} packed with an unexpected name or version.`)
  }
  exactInternalDependencies(manifest, entry.name, versions)
  await assertPackedSourceDependencies(tarball, manifest, entry.name)
  return Object.freeze({ entry, tarball })
}

async function assertInstalledPackagesAreExternal(
  consumerRoot: string,
  versions: ReadonlyMap<string, string>,
): Promise<void> {
  const canonicalConsumerRoot = await realpath(consumerRoot)
  for (const entry of PUBLIC_PACKAGES) {
    const installedRoot = await realpath(join(consumerRoot, 'node_modules', ...entry.name.split('/')))
    const consumerRelative = relative(canonicalConsumerRoot, installedRoot)
    if (consumerRelative.startsWith('..') || resolve(installedRoot).startsWith(`${REPOSITORY_ROOT}/`)) {
      throw new Error(
        `${entry.name} resolved outside the packed consumer: ${installedRoot} (consumer ${consumerRoot}).`,
      )
    }
    const manifest = JSON.parse(
      await readFile(join(installedRoot, 'package.json'), 'utf8'),
    ) as Record<string, unknown>
    const expectedVersion = versions.get(entry.name)
    if (manifest.name !== entry.name || manifest.version !== expectedVersion) {
      throw new Error(`${entry.name} did not install at ${expectedVersion}.`)
    }
  }
}

async function main(): Promise<void> {
  const versions = new Map(await Promise.all(PUBLIC_PACKAGES.map(async (entry) => {
    const manifest = JSON.parse(
      await readFile(join(REPOSITORY_ROOT, entry.directory, 'package.json'), 'utf8'),
    ) as { version?: string }
    if (!manifest.version) throw new Error(`${entry.name} has no release version.`)
    return [entry.name, manifest.version] as const
  })))
  const testRoot = await mkdtemp(join(tmpdir(), 'omnidraw-packed-public-composition-'))
  const packRoot = join(testRoot, 'packs')
  const consumerRoot = join(testRoot, 'consumer')
  const installCache = join(testRoot, 'install-cache')
  await Promise.all([
    mkdir(packRoot, { recursive: true }),
    mkdir(consumerRoot, { recursive: true }),
    mkdir(installCache, { recursive: true }),
  ])

  try {
    const packed: Array<Readonly<{ entry: TPublicPackage; tarball: string }>> = []
    for (const entry of PUBLIC_PACKAGES) {
      packed.push(await packPublicPackage(entry, packRoot, versions))
    }
    const dependencies = Object.fromEntries(packed.map(({ entry, tarball }) => [
      entry.name,
      `file:${tarball}`,
    ]))
    await writeFile(join(consumerRoot, 'package.json'), `${JSON.stringify({
      name: '@omnidraw-fixtures/packed-public-consumer',
      version: '0.0.0',
      private: true,
      type: 'module',
      dependencies: {
        ...dependencies,
        'solid-js': '1.9.14',
      },
      // Exact transitive @omnidraw dependencies normally resolve from npm.
      // The isolated acceptance consumer substitutes only the five tarballs it
      // just packed; no workspace link or source directory participates.
      overrides: dependencies,
      devDependencies: {
        'bun-types': '1.3.14',
        typescript: '7.0.2',
      },
    }, null, 2)}\n`)
    await Promise.all([
      cp(join(FIXTURE_ROOT, 'src'), join(consumerRoot, 'src'), { recursive: true }),
      cp(
        join(FIXTURE_ROOT, 'external-composition.test.ts'),
        join(consumerRoot, 'external-composition.test.ts'),
      ),
      cp(join(FIXTURE_ROOT, 'tsconfig.json'), join(consumerRoot, 'tsconfig.json')),
    ])

    const installEnvironment = {
      ...process.env,
      BUN_INSTALL_CACHE_DIR: installCache,
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
    await assertInstalledPackagesAreExternal(consumerRoot, versions)

    const lockPath = join(consumerRoot, 'bun.lock')
    const lockText = await readFile(lockPath, 'utf8')
    if (lockText.includes(REPOSITORY_ROOT) || lockText.includes('workspace:')) {
      throw new Error('The packed consumer lockfile retained workspace source resolution.')
    }
    const installedScope = await readdir(join(consumerRoot, 'node_modules', '@omnidraw'))
    const allowedScope = new Set([
      ...PUBLIC_PACKAGES.map((entry) => entry.name.split('/')[1]!),
      'cangine',
      'capsule',
    ])
    if (installedScope.some((name) => !allowedScope.has(name))) {
      throw new Error('The packed consumer installed an unexpected @omnidraw package set.')
    }
    for (const entry of PUBLIC_PACKAGES) {
      if (!installedScope.includes(entry.name.split('/')[1]!)) {
        throw new Error(`The packed consumer omitted ${entry.name}.`)
      }
    }

    await runCommand([
      process.execPath,
      join(consumerRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      'tsconfig.json',
      '--noEmit',
    ], consumerRoot)
    const tests = await runCommand(
      [process.execPath, 'test', 'external-composition.test.ts'],
      consumerRoot,
    )
    await runCommand(
      [process.execPath, 'run', 'src/packed-consumer.ts'],
      consumerRoot,
    )

    const passingTests = `${tests.stdout}\n${tests.stderr}`.match(/\b2 pass\b/)
    if (!passingTests) throw new Error('The packed managed-composition tests did not report two passes.')
    console.log(
      `[packed-public-composition] packed ${packed.length} independently versioned packages; clean install, typecheck, 2 tests, and runtime smoke passed`,
    )
  } finally {
    await rm(testRoot, { recursive: true, force: true })
  }
}

await main()
