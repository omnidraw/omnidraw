#!/usr/bin/env bun

/** @file Proves the packed public SDK offline checker in an external consumer. */

import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

type TPackage = Readonly<{ name: string; directory: string }>

const REPOSITORY_ROOT = resolve(import.meta.dir, '..')
const PACKAGES: readonly TPackage[] = Object.freeze([
  { name: '@omnidraw/sdk', directory: 'packages/sdk' },
])

async function run(
  command: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Readonly<{ stdout: string; stderr: string; exitCode: number }>> {
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
  return { stdout, stderr, exitCode }
}

async function requireSuccess(
  command: readonly string[],
  cwd: string,
  env?: Readonly<Record<string, string | undefined>>,
): Promise<string> {
  const result = await run(command, cwd, env)
  if (result.exitCode !== 0) {
    throw new Error([
      `Command failed (${result.exitCode}): ${command.join(' ')}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join('\n'))
  }
  return result.stdout
}

async function pack(entry: TPackage, packRoot: string): Promise<string> {
  const packageRoot = join(REPOSITORY_ROOT, entry.directory)
  await requireSuccess([process.execPath, 'run', 'build'], packageRoot)
  const releaseRoot = join(packageRoot, 'dist')
  const output = await requireSuccess(
    [process.execPath, 'pm', 'pack', '--destination', packRoot, '--quiet'],
    releaseRoot,
  )
  const reported = output.trim().split('\n').filter(Boolean).at(-1)
  if (reported === undefined) throw new Error(`${entry.name} did not report a tarball.`)
  const tarball = resolve(releaseRoot, reported)
  if (dirname(tarball) !== packRoot) throw new Error(`${entry.name} pack escaped the pack root.`)
  return tarball
}

async function main(): Promise<void> {
  const testRoot = await mkdtemp(
    join(tmpdir(), 'omnidraw-packed-sdk-check-'),
  )
  const packRoot = join(testRoot, 'packs')
  const consumerRoot = join(testRoot, 'consumer')
  const fakeHome = join(testRoot, 'fake-home')
  await Promise.all([
    mkdir(packRoot, { recursive: true }),
    mkdir(join(consumerRoot, 'ui'), { recursive: true }),
    mkdir(fakeHome, { recursive: true }),
  ])
  try {
    const packedEntries = [] as Array<Readonly<{ entry: TPackage; tarball: string }>>
    for (const entry of PACKAGES) packedEntries.push({ entry, tarball: await pack(entry, packRoot) })
    const fileDependencies = Object.fromEntries(packedEntries.map(({ entry, tarball }) => [
      entry.name,
      `file:${tarball}`,
    ]))
    await writeFile(join(consumerRoot, 'package.json'), `${JSON.stringify({
      name: 'packed-sdk-offline-widget',
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts: {
        check: 'omnidraw-widget check .',
        build: 'omnidraw-widget build .',
      },
      dependencies: {
        '@omnidraw/sdk': fileDependencies['@omnidraw/sdk'],
        typescript: '5.9.3',
      },
    }, null, 2)}\n`)
    await writeFile(join(consumerRoot, 'omnidraw.json'), `${JSON.stringify({
      $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
      schemaVersion: 1,
      name: 'Packed SDK Offline Widget',
      slug: 'packed-sdk-offline-widget',
      description: 'Runs only from packed public dependencies.',
      tool: { label: 'Packed SDK Offline Widget', group: null, priority: 0 },
      ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
      resources: [{
        slot: 'store',
        resourceId: 'not-installed-but-syntactically-valid',
        kind: 'kv',
        effect: 'read',
        required: true,
      }],
    }, null, 2)}\n`)
    await writeFile(join(consumerRoot, 'tsconfig.json'), `${JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        lib: ['ES2022', 'DOM'],
      },
      include: ['ui/**/*.ts'],
    }, null, 2)}\n`)
    await writeFile(join(consumerRoot, 'ui/main.ts'), [
      'const output = document.createElement("output");',
      'output.textContent = "packed SDK check";',
      'document.body.append(output);',
      '',
    ].join('\n'))
    await writeFile(join(consumerRoot, 'conformance-smoke.mjs'), [
      'import {',
      '  WIDGET_SDK_ARTIFACT_ADMISSION_VECTORS,',
      '  WIDGET_SDK_FUNCTION_SCENARIOS,',
      '  WIDGET_SDK_MODULE_ADMISSION_VECTORS,',
      '  WIDGET_SDK_RESOURCE_PROVIDER_SCENARIOS,',
      '  WIDGET_SDK_RESOURCE_WIRE_VECTORS,',
      '  WIDGET_SDK_SERVER_MODULE_VECTOR,',
      '  WIDGET_SDK_SQL_PROFILE_VECTORS,',
      '  fnCreateWidgetSdkConformanceServerModuleArtifact,',
      '} from "@omnidraw/sdk/conformance";',
      'const artifact = fnCreateWidgetSdkConformanceServerModuleArtifact();',
      'console.log(JSON.stringify({',
      '  artifactVectors: WIDGET_SDK_ARTIFACT_ADMISSION_VECTORS.length,',
      '  functionScenarios: WIDGET_SDK_FUNCTION_SCENARIOS.length,',
      '  admissionVectors: WIDGET_SDK_MODULE_ADMISSION_VECTORS.length,',
      '  wireVectors: WIDGET_SDK_RESOURCE_WIRE_VECTORS.length,',
      '  sqlVectors: WIDGET_SDK_SQL_PROFILE_VECTORS.length,',
      '  providerFamilies: WIDGET_SDK_RESOURCE_PROVIDER_SCENARIOS.length,',
      '  providerSteps: WIDGET_SDK_RESOURCE_PROVIDER_SCENARIOS.reduce((count, scenario) => count + scenario.steps.length, 0),',
      '  moduleBytes: artifact.moduleBytes.byteLength,',
      '  moduleDigestSha256: artifact.moduleDigestSha256,',
      '  descriptorBytes: WIDGET_SDK_SERVER_MODULE_VECTOR.functionDescriptorsBytes.length,',
      '  descriptorCount: artifact.functionDescriptors.length,',
      '  artifactDigestSha256: WIDGET_SDK_SERVER_MODULE_VECTOR.artifactDigestSha256,',
      '}));',
      '',
    ].join('\n'))
    await writeFile(join(fakeHome, 'main.db'), 'must not be opened\n')

    await requireSuccess(
      [process.execPath, 'install', '--ignore-scripts'],
      consumerRoot,
      { ...process.env, TMPDIR: testRoot },
    )
    const installedSdk = await realpath(join(consumerRoot, 'node_modules/@omnidraw/sdk'))
    const consumerCanonical = await realpath(consumerRoot)
    const installedRelative = relative(consumerCanonical, installedSdk)
    if (installedRelative.startsWith('..') || installedSdk.startsWith(`${REPOSITORY_ROOT}/`)) {
      throw new Error('Packed SDK resolved to workspace source.')
    }
    const installedManifest = JSON.parse(
      await readFile(join(installedSdk, 'package.json'), 'utf8'),
    ) as { bin?: Record<string, string> }
    if (installedManifest.bin?.['omnidraw-widget'] !== './cli.js') {
      throw new Error('Packed SDK omitted the public omnidraw-widget bin.')
    }
    const conformanceSource = await readFile(join(installedSdk, 'conformance.js'), 'utf8')
    if (/^\s*(?:import\s|export\s+(?:\*|\{[^}]*\})\s+from\s)/m.test(conformanceSource)) {
      throw new Error('Packed SDK conformance retained an external module import graph.')
    }
    if (/(?:^|[\s'"`])(?:apps\/|#backend|workspace:)/m.test(conformanceSource)) {
      throw new Error('Packed SDK conformance retained a workspace or application reference.')
    }
    const conformance = JSON.parse(await requireSuccess(
      [process.execPath, 'run', 'conformance-smoke.mjs'],
      consumerRoot,
    )) as {
      artifactVectors?: number
      functionScenarios?: number
      admissionVectors?: number
      wireVectors?: number
      sqlVectors?: number
      providerFamilies?: number
      providerSteps?: number
      moduleBytes?: number
      moduleDigestSha256?: string
      descriptorBytes?: number
      descriptorCount?: number
      artifactDigestSha256?: string
    }
    if (
      conformance.artifactVectors !== 4
      || conformance.functionScenarios !== 16
      || conformance.admissionVectors !== 41
      || conformance.wireVectors !== 6
      || conformance.sqlVectors !== 13
      || conformance.providerFamilies !== 7
      || conformance.providerSteps !== 41
      || (conformance.moduleBytes ?? 0) < 100
      || (conformance.descriptorBytes ?? 0) < 100
      || conformance.descriptorCount !== 16
      || !/^[0-9a-f]{64}$/.test(conformance.moduleDigestSha256 ?? '')
      || !/^[0-9a-f]{64}$/.test(conformance.artifactDigestSha256 ?? '')
    ) throw new Error('Packed SDK conformance subpath omitted the canonical portability kit.')

    const trapModule = join(testRoot, 'connection-trap.cjs')
    const trapEvidence = join(testRoot, 'connection-attempted')
    await writeFile(trapModule, [
      'const fs = require("node:fs");',
      'const trap = () => {',
      '  fs.appendFileSync(process.env.OFFLINE_CONNECTION_EVIDENCE, "attempted\\n");',
      '  throw new Error("packed offline checker attempted network access");',
      '};',
      'const net = require("node:net");',
      'net.connect = trap;',
      'net.createConnection = trap;',
      'net.Socket.prototype.connect = trap;',
      'globalThis.fetch = trap;',
      '',
    ].join('\n'))
    const databaseBefore = await stat(join(fakeHome, 'main.db'))
    const checkEnvironment = {
      ...process.env,
      OMNIDRAW_HOME: fakeHome,
      OMNIDRAW_HOST_TOKEN: 'must-not-be-echoed',
      DATABASE_URL: `file:${join(fakeHome, 'main.db')}`,
      HTTP_PROXY: 'http://127.0.0.1:1',
      HTTPS_PROXY: 'http://127.0.0.1:1',
      NO_PROXY: '',
      NODE_OPTIONS: `--require=${trapModule}`,
      OFFLINE_CONNECTION_EVIDENCE: trapEvidence,
    }
    const cli = join(installedSdk, 'cli.js')
    const first = await run(['node', cli, 'check', '.', '--json'], consumerRoot, checkEnvironment)
    const second = await run(['node', cli, 'check', '.', '--json'], consumerRoot, checkEnvironment)
    if (first.exitCode !== 0 || second.exitCode !== 0 || first.stderr !== '' || second.stderr !== '') {
      throw new Error(`Packed SDK checker failed:\n${first.stdout}\n${first.stderr}\n${second.stdout}\n${second.stderr}`)
    }
    if (first.stdout !== second.stdout) throw new Error('Packed SDK checker output was not deterministic.')
    const report = JSON.parse(first.stdout) as {
      ok?: boolean
      limitations?: readonly string[]
    }
    if (
      report.ok !== true
      || !report.limitations?.includes('resource-existence-not-checked')
      || !report.limitations?.includes('preview-runtime-not-checked')
    ) throw new Error('Packed SDK checker omitted its fixed offline limitations.')
    if (first.stdout.includes(testRoot) || first.stdout.includes('must-not-be-echoed')) {
      throw new Error('Packed SDK checker exposed host-local data.')
    }
    if (await Bun.file(trapEvidence).exists()) throw new Error('Packed SDK checker attempted network access.')
    if ((await stat(join(fakeHome, 'main.db'))).mtimeMs !== databaseBefore.mtimeMs) {
      throw new Error('Packed SDK checker changed the fake Omnidraw database.')
    }
    console.log('[packed-sdk-offline-check] packed external install and deterministic host-free check passed')
  } finally {
    await rm(testRoot, { recursive: true, force: true })
  }
}

await main()
