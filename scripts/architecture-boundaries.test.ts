import { describe, expect, test } from 'bun:test'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'
import {
  type ICollaborationService,
  type IService,
  type IServiceRegistry,
} from '../packages/runtime/src'
import type { IAutomergeService } from '../packages/service-automerge/src/IAutomergeService'
import { actorsContract } from '../packages/api/src/actor/contract'
import { actorsHandlers } from '../packages/api/src/actor/handlers'

const ROOT = resolve(import.meta.dir, '..')
const FIXTURE_ROOT = join(ROOT, 'scripts/fixtures/external-composition')
const PUBLIC_PACKAGES = Object.freeze({
  '@vibecanvas/function-runtime': 'packages/function-runtime',
  '@vibecanvas/resource-runtime': 'packages/resource-runtime',
  '@vibecanvas/runtime': 'packages/runtime',
  '@vibecanvas/tenant-core': 'packages/tenant-core',
  '@vibecanvas/widget-contract': 'packages/widget-contract',
})
const UI_PACKAGES = Object.freeze({
  '@vibecanvas/ui-ai-chat': {
    directory: 'packages/ui-ai-chat',
    exports: {
      '.': './src/index.ts',
      './canvas-extension': './src/canvas-extension/index.ts',
      './chat': './src/chat/index.tsx',
      './sidebar': './src/sidebar/index.ts',
      './widget': './src/widget/index.ts',
      './widget-runtime': './src/widget-runtime/index.ts',
    },
  },
  '@vibecanvas/ui-actor-legacy': {
    directory: 'packages/ui-actor-legacy',
    exports: {
      '.': './src/index.ts',
      './*': './src/*',
      './styles.css': './src/styles.css',
    },
  },
})
const SOURCE_EXTENSIONS = new Set([
  '.astro',
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mdx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
])
const FORBIDDEN_MANAGED_PACKAGE_FAMILIES = Object.freeze([
  /^pg(?:$|[-_.]|vector)/i,
  /^postgres/i,
  /^pglite(?:$|[-_.])/i,
  /^@electric-sql\/pglite$/i,
  /^resonate/i,
  /^@resonatehq\//i,
  /^temporal(?:io)?(?:$|[-_.])/i,
  /^@temporalio\//i,
  /^trigger(?:$|[-_.])/i,
  /^@trigger\.dev\//i,
  /^inngest(?:$|[-_.])/i,
  /^restate(?:$|[-_.])/i,
  /^@restatedev\//i,
  /^(?:durable[-_.])?workflow(?:$|[-_.])/i,
])

declare module '../packages/runtime/src/interface' {
  interface IServiceMap {
    localCollaboration: ICollaborationService & IService
  }
}

function registerLocalCollaboration(
  services: IServiceRegistry,
  collaboration: IAutomergeService,
): void {
  services.provide('localCollaboration', 10, collaboration)
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(path))
    else files.push(path)
  }
  return files.sort()
}

function moduleSpecifiers(source: string): string[] {
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

function dependencyPackageName(specifier: string): string {
  const normalized = specifier.startsWith('npm:') ? specifier.slice(4) : specifier
  if (normalized.startsWith('@')) {
    const [scope = '', rawName = ''] = normalized.split('/')
    return `${scope}/${rawName.replace(/@[^@/]+$/, '')}`
  }
  return (normalized.split('/')[0] ?? '').replace(/@[^@/]+$/, '')
}

function isForbiddenManagedDependency(specifier: string): boolean {
  const packageName = dependencyPackageName(specifier)
  const baseName = packageName.startsWith('@')
    ? packageName.split('/')[1] ?? ''
    : packageName
  return FORBIDDEN_MANAGED_PACKAGE_FAMILIES.some((family) => (
    family.test(packageName) || family.test(baseName)
  ))
}

function manifestDependencies(manifest: Awaited<ReturnType<typeof packageManifests>>[number]['manifest']): string[] {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]
}

function publicPackageName(specifier: string): string | null {
  if (!specifier.startsWith('@vibecanvas/')) return null
  return specifier.split('/').slice(0, 2).join('/')
}

async function sourceFiles(directory: string): Promise<string[]> {
  return (await listFiles(directory)).filter((path) => SOURCE_EXTENSIONS.has(extname(path)))
}

async function packageManifests(): Promise<Array<{
  path: string
  manifest: {
    name?: string
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  }
}>> {
  const roots = ['apps', 'packages', 'scripts/fixtures'].map((directory) => join(ROOT, directory))
  const files = [
    join(ROOT, 'package.json'),
    ...(await Promise.all(roots.map(listFiles))).flat()
      .filter((path) => path.endsWith(`${sep}package.json`)),
  ]
  return Promise.all(files.map(async (path) => ({
    path,
    manifest: JSON.parse(await readFile(path, 'utf8')),
  })))
}

describe('managed composition architecture boundaries', () => {
  test('keeps the consolidated API as the only API package and import namespace', async () => {
    const manifests = await packageManifests()
    const oldApiFiles = (await listFiles(join(ROOT, 'packages')))
      .map((path) => relative(join(ROOT, 'packages'), path))
      .filter((path) => path.split(sep)[0]?.startsWith('api-'))
    expect(oldApiFiles).toEqual([])

    const apiPackages = manifests
      .filter(({ manifest }) => manifest.name === '@vibecanvas/api' || manifest.name?.startsWith('@vibecanvas/api-'))
      .map(({ manifest }) => manifest.name)
      .sort()
    expect(apiPackages).toEqual(['@vibecanvas/api'])
    expect(
      manifests.find(({ manifest }) => manifest.name === '@vibecanvas/api')?.path,
    ).toBe(join(ROOT, 'packages/api/package.json'))
    expect(manifests.flatMap(({ path, manifest }) => (
      manifestDependencies(manifest)
        .filter((dependency) => dependency.startsWith('@vibecanvas/api-'))
        .map((dependency) => `${relative(ROOT, path)} depends on ${dependency}`)
    ))).toEqual([])

    const violations: string[] = []
    for (const root of ['apps', 'packages', 'scripts']) {
      for (const file of await sourceFiles(join(ROOT, root))) {
        const source = await readFile(file, 'utf8')
        for (const specifier of moduleSpecifiers(source)) {
          if (specifier.startsWith('@vibecanvas/api-')) {
            violations.push(`${relative(ROOT, file)} imports ${specifier}`)
          }
        }
      }
    }
    expect(violations).toEqual([])
  })

  test('keeps the renamed UI packages and their public export maps exact', async () => {
    const manifests = await packageManifests()
    const oldUiFiles = (await listFiles(join(ROOT, 'packages')))
      .map((path) => relative(join(ROOT, 'packages'), path))
      .filter((path) => ['actor-ui', 'ai-chat'].includes(path.split(sep)[0] ?? ''))
    expect(oldUiFiles).toEqual([])

    const packageNames = new Set(manifests.map(({ manifest }) => manifest.name).filter(Boolean))
    expect(packageNames.has('@vibecanvas/ai-chat')).toBe(false)
    expect(packageNames.has('@vibecanvas/actor-ui')).toBe(false)
    expect(manifests.flatMap(({ path, manifest }) => (
      manifestDependencies(manifest)
        .filter((dependency) => dependency === '@vibecanvas/ai-chat' || dependency === '@vibecanvas/actor-ui')
        .map((dependency) => `${relative(ROOT, path)} depends on ${dependency}`)
    ))).toEqual([])

    for (const [name, expected] of Object.entries(UI_PACKAGES)) {
      const manifestPath = join(ROOT, expected.directory, 'package.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        name: string
        exports: Record<string, string>
      }
      expect(manifest.name).toBe(name)
      expect(manifest.exports).toEqual(expected.exports)
    }

    const oldUiImports: string[] = []
    for (const root of ['apps', 'packages', 'scripts']) {
      for (const file of await sourceFiles(join(ROOT, root))) {
        const source = await readFile(file, 'utf8')
        for (const specifier of moduleSpecifiers(source)) {
          if (specifier === '@vibecanvas/ai-chat' || specifier.startsWith('@vibecanvas/ai-chat/')) {
            oldUiImports.push(`${relative(ROOT, file)} imports ${specifier}`)
          }
          if (specifier === '@vibecanvas/actor-ui' || specifier.startsWith('@vibecanvas/actor-ui/')) {
            oldUiImports.push(`${relative(ROOT, file)} imports ${specifier}`)
          }
        }
      }
    }
    expect(oldUiImports).toEqual([])
  })

  test('excludes PostgreSQL, Resonate, durable-workflow, and schedule/wait state', async () => {
    for (const dependency of [
      'pg',
      'pg-pool',
      'pgvector',
      'postgres.js',
      'postgres-array',
      'postgresql-client',
      '@types/pg',
      '@electric-sql/pglite',
      '@resonatehq/sdk',
      'resonate-sdk',
      '@temporalio/workflow',
      '@trigger.dev/sdk',
      'inngest',
      '@restatedev/restate-sdk',
      'durable-workflow',
    ]) {
      expect(isForbiddenManagedDependency(dependency), dependency).toBe(true)
    }
    for (const dependency of ['@vibecanvas/runtime', 'sqlite', 'turso', '@libsql/client']) {
      expect(isForbiddenManagedDependency(dependency), dependency).toBe(false)
    }

    const forbiddenDependencies: string[] = []
    for (const { path, manifest } of await packageManifests()) {
      for (const group of [
        manifest.dependencies,
        manifest.devDependencies,
        manifest.optionalDependencies,
        manifest.peerDependencies,
      ]) {
        for (const [dependency, specifier] of Object.entries(group ?? {})) {
          if (isForbiddenManagedDependency(dependency) || isForbiddenManagedDependency(specifier)) {
            forbiddenDependencies.push(`${relative(ROOT, path)} depends on ${dependency}@${specifier}`)
          }
        }
      }
    }
    expect(forbiddenDependencies).toEqual([])

    const lockfile = await readFile(join(ROOT, 'bun.lock'), 'utf8')
    const forbiddenLockEntries = [...lockfile.matchAll(/"([^"]+)"/g)]
      .map((match) => match[1]!)
      .filter(isForbiddenManagedDependency)
    expect(forbiddenLockEntries).toEqual([])

    const forbiddenImports: string[] = []
    for (const root of ['apps', 'packages', 'scripts']) {
      for (const file of await sourceFiles(join(ROOT, root))) {
        const source = await readFile(file, 'utf8')
        for (const specifier of moduleSpecifiers(source)) {
          if (isForbiddenManagedDependency(specifier)) {
            forbiddenImports.push(`${relative(ROOT, file)} imports ${specifier}`)
          }
        }
      }
    }
    expect(forbiddenImports).toEqual([])

    const migrationRoot = join(ROOT, 'packages/service-db/src/migrations')
    const statefulSchemaViolations: string[] = []
    for (const migrationPath of (await listFiles(migrationRoot)).filter((path) => extname(path) === '.sql')) {
      const migration = await readFile(migrationPath, 'utf8')
      if (/\b(?:workflow|workflows|schedule|scheduled|schedules|wait|waiting|waits)\b/i.test(migration)) {
        statefulSchemaViolations.push(relative(ROOT, migrationPath))
      }
    }
    expect(statefulSchemaViolations).toEqual([])
  })

  test('structurally exposes local collaboration through a public seam', () => {
    expect(registerLocalCollaboration).toBeInstanceOf(Function)
  })

  test('keeps release dependencies exact while Bun links the same versions for local development', async () => {
    const fixturePackage = JSON.parse(await readFile(join(FIXTURE_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(fixturePackage.dependencies).toEqual(Object.fromEntries(
      Object.keys(PUBLIC_PACKAGES).sort().map((name) => [name, '0.1.0']),
    ))

    for (const [name, directory] of Object.entries(PUBLIC_PACKAGES)) {
      const packageJson = JSON.parse(await readFile(join(ROOT, directory, 'package.json'), 'utf8')) as {
        name: string
        version?: string
        private?: boolean
        exports?: Record<string, unknown>
        dependencies?: Record<string, string>
      }
      expect(packageJson.name).toBe(name)
      expect(packageJson.version).toBe(fixturePackage.dependencies[name])
      expect(packageJson.private).not.toBe(true)
      expect(packageJson.exports?.['.']).toBeDefined()
      for (const [dependencyName, dependencyVersion] of Object.entries(packageJson.dependencies ?? {})) {
        if (!Object.hasOwn(PUBLIC_PACKAGES, dependencyName)) continue
        expect(dependencyVersion, `${name} must pin ${dependencyName} exactly`).toBe('0.1.0')
      }
    }

    const rootPackage = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as {
      workspaces: string[]
    }
    expect(rootPackage.workspaces).toContain('scripts/fixtures/external-composition')
  })

  test('imports only documented public package exports and fixture-local modules', async () => {
    const files = await sourceFiles(FIXTURE_ROOT)
    const allowedPackages = new Set(Object.keys(PUBLIC_PACKAGES))
    const packageExports = new Map(await Promise.all(
      Object.entries(PUBLIC_PACKAGES).map(async ([name, directory]) => {
        const manifest = JSON.parse(
          await readFile(join(ROOT, directory, 'package.json'), 'utf8'),
        ) as { exports?: Record<string, unknown> }
        return [name, Object.keys(manifest.exports ?? {})] as const
      }),
    ))
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      for (const specifier of moduleSpecifiers(source)) {
        if (specifier === 'bun:test') continue
        if (specifier.startsWith('.')) {
          expect(specifier.startsWith('..'), `${relative(ROOT, file)} escapes its fixture`).toBe(false)
          continue
        }
        const packageName = publicPackageName(specifier)
        expect(
          packageName !== null && allowedPackages.has(packageName),
          `${relative(ROOT, file)} imports ${specifier}`,
        ).toBe(true)
        if (packageName === null) continue
        const exportKey = specifier === packageName ? '.' : `.${specifier.slice(packageName.length)}`
        const exports = packageExports.get(packageName) ?? []
        const documented = exports.includes(exportKey) || exports.some((candidate) => (
          candidate.endsWith('*')
          && exportKey.startsWith(candidate.slice(0, -1))
          && exportKey.length > candidate.length - 1
        ))
        expect(documented, `${relative(ROOT, file)} imports undocumented ${specifier}`).toBe(true)
      }
    }

    const tsconfig = JSON.parse(await readFile(join(FIXTURE_ROOT, 'tsconfig.json'), 'utf8')) as {
      extends?: unknown
      compilerOptions?: { paths?: unknown }
    }
    expect(tsconfig.extends).toBeUndefined()
    expect(tsconfig.compilerOptions?.paths).toBeUndefined()
  })

  test('contains no source-copy, patch, private implementation, or API-handler coupling escape hatch', async () => {
    const fixtureFiles = await listFiles(FIXTURE_ROOT)
    expect(fixtureFiles.some((path) => ['.patch', '.diff'].includes(extname(path)))).toBe(false)
    expect(fixtureFiles.some((path) => path.split(sep).includes('patches'))).toBe(false)

    const fixtureText = (await Promise.all(fixtureFiles.map((path) => readFile(path, 'utf8')))).join('\n')
    expect(fixtureText).not.toContain('workspace:')
    expect(fixtureText).not.toContain('file:')
    expect(fixtureText).not.toContain('link:')
    expect(fixtureText).not.toMatch(/@vibecanvas\/[^'"\s]+\/src\//)
    expect(fixtureText).not.toContain('../../packages')
    expect(fixtureText).not.toContain('apps/cli')
    expect(fixtureText).not.toContain('@vibecanvas/api')
    expect(fixtureText).not.toContain('@vibecanvas/service-')

    const apiFiles = await sourceFiles(join(ROOT, 'packages/api/src'))
    const apiText = (await Promise.all(apiFiles.map((path) => readFile(path, 'utf8')))).join('\n')
    expect(apiText).not.toContain('external-composition')
    expect(apiText).not.toContain('@vibecanvas-fixtures/private-managed-composition')
  })

  test('keeps public contract packages free of private Vibecanvas dependencies', async () => {
    const allowedPublicPackages = new Set(Object.keys(PUBLIC_PACKAGES))
    for (const directory of Object.values(PUBLIC_PACKAGES)) {
      for (const file of await sourceFiles(join(ROOT, directory, 'src'))) {
        const source = await readFile(file, 'utf8')
        for (const specifier of moduleSpecifiers(source)) {
          const packageName = publicPackageName(specifier)
          if (!packageName) continue
          expect(
            allowedPublicPackages.has(packageName),
            `${relative(ROOT, file)} imports private package ${specifier}`,
          ).toBe(true)
        }
      }
    }
  })

  test('keeps generic widget frame and tool contracts out of the legacy actor package', async () => {
    const consumerRoots = [
      'packages/api/src',
      'packages/canvas/src',
      'packages/orpc-client/src',
      'packages/service-agent/src',
      'packages/ui-ai-chat/src',
      'apps/frontend/src',
    ]
    const violations: string[] = []
    const forbiddenPath = /@vibecanvas\/service-actor\/core\/(?:fn\.widget-frame|CONSTANTS|tool-icon)/
    const actorToolSchema = /import\s*\{[^}]*\bZVibecanvasToolIcon\b[^}]*\}\s*from\s*['"]@vibecanvas\/service-actor\/core\/vibecanvasjson\.zod['"]/s

    for (const directory of consumerRoots) {
      for (const file of await sourceFiles(join(ROOT, directory))) {
        const source = await readFile(file, 'utf8')
        if (forbiddenPath.test(source) || actorToolSchema.test(source)) {
          violations.push(relative(ROOT, file))
        }
      }
    }
    expect(violations).toEqual([])
  })

  test('keeps legacy actor processes and publication behind the explicit plugin capability', async () => {
    const [agentSource, capabilitySource, legacyInterfaceSource, coreTypesSource, pluginSource, setupSource] = await Promise.all([
      readFile(join(ROOT, 'packages/service-agent/src/AgentService.ts'), 'utf8'),
      readFile(join(ROOT, 'packages/service-agent/src/legacy/LegacyActorAgentCapability.ts'), 'utf8'),
      readFile(join(ROOT, 'packages/service-agent/src/legacy/interface.ts'), 'utf8'),
      readFile(join(ROOT, 'packages/service-agent/src/core/types.ts'), 'utf8'),
      readFile(join(ROOT, 'apps/cli/src/plugins/legacy-actor/LegacyActorPlugin.ts'), 'utf8'),
      readFile(join(ROOT, 'apps/cli/src/setup-services.ts'), 'utf8'),
    ])
    const runtimeActorImport = /import\s+(?!type\b)[^;\n]*from\s*['"]@vibecanvas\/service-actor/
    const defaultAgentActorRuntimeImports: string[] = []
    for (const file of await sourceFiles(join(ROOT, 'packages/service-agent/src'))) {
      if (file.includes(`${sep}legacy${sep}`)) continue
      if (runtimeActorImport.test(await readFile(file, 'utf8'))) {
        defaultAgentActorRuntimeImports.push(relative(ROOT, file))
      }
    }

    expect(defaultAgentActorRuntimeImports).toEqual([])
    expect(agentSource).not.toMatch(runtimeActorImport)
    expect(agentSource).not.toContain('new Actor(')
    expect(agentSource).not.toContain('ActorResourceError')
    expect(agentSource).not.toContain('txPublishWidgetDraft')
    expect(agentSource).not.toContain('actorService?:')
    expect(agentSource).toContain('legacyActor?: TLegacyActorAgentCapabilityFactory')

    expect(capabilitySource).toMatch(runtimeActorImport)
    expect(capabilitySource).toContain('new Actor(')
    expect(capabilitySource).not.toContain('txPublishWidgetDraft')
    expect(capabilitySource).not.toContain('transitionDefinitionPublication')
    expect(capabilitySource).toContain('Publish manifest v2 through the widget draft API')
    expect(legacyInterfaceSource).toContain('TLegacyActorServiceCapability')
    expect(coreTypesSource).not.toContain('TActorServiceReloader')
    expect(coreTypesSource).not.toContain('ActorResource')
    expect(pluginSource).toContain('createLegacyActorAgentCapabilityFactory')
    expect(pluginSource).toContain('capability.diagnostics().activeProcessCount')
    expect(setupSource).not.toContain("from '@vibecanvas/service-actor'")
    expect(setupSource).not.toContain('new ActorService')
  })

  test('keeps actor compatibility routes exact and leaves resources neutral-only', async () => {
    expect(Object.keys(actorsContract).sort()).toEqual(['definitions', 'events', 'instances'])
    expect(Object.keys(actorsHandlers).sort()).toEqual(['definitions', 'events', 'instances'])
    expect(Object.keys(actorsContract.definitions).sort()).toEqual(['delete', 'get', 'list'])
    expect(Object.keys(actorsContract.instances).sort()).toEqual(['sendMessage', 'snapshot'])
    expect(Object.keys(actorsHandlers.definitions).sort()).toEqual(['delete', 'get', 'list'])
    expect(Object.keys(actorsHandlers.instances).sort()).toEqual(['sendMessage', 'snapshot'])

    const [contractSource, handlerSource, resourceContractSource, resourceApiSource, resourceErrorSource] = await Promise.all([
      readFile(join(ROOT, 'packages/api/src/actor/contract.ts'), 'utf8'),
      readFile(join(ROOT, 'packages/api/src/actor/handlers.ts'), 'utf8'),
      readFile(join(ROOT, 'packages/api/src/resource/contract.ts'), 'utf8'),
      readFile(join(ROOT, 'packages/api/src/resource/api.resources.ts'), 'utf8'),
      readFile(join(ROOT, 'packages/api/src/resource/api.resource-error.ts'), 'utf8'),
    ])
    for (const source of [contractSource, handlerSource]) {
      expect(source).not.toMatch(/\.\.\/resource\//)
      expect(source).not.toMatch(/\bresource(?:Contract|Handlers)\b/)
      expect(source).not.toMatch(/\b(?:resources|dbResources|dbRows|dbDrafts|dbApplies|dbBackups)\s*:/)
    }
    expect(resourceContractSource).not.toMatch(/export\s+const\s+Z(?:Create)?ActorResource/)
    expect(resourceContractSource).not.toContain('ACTOR_RESOURCE_ERROR')
    expect(resourceApiSource).not.toMatch(/export\s+const\s+api\w*ActorResource/)
    expect(resourceErrorSource).not.toContain('withActorResourceApiError')
  })

  test('keeps the legacy actor package free of resource ownership modules and wildcard exports', async () => {
    const actorPackageRoot = join(ROOT, 'packages/service-actor')
    const retiredFiles = [
      'src/resources/ActorResourceError.ts',
      'src/resources/ActorResourceKeyValuePersistence.ts',
      'src/resources/ActorResourceKeyValueStore.ts',
      'src/resources/ActorResourceManager.ts',
      'src/resources/DbResource.ts',
      'src/resources/DbResourceCoordinator.ts',
      'src/resources/KvResource.ts',
      'src/resources/SecretStoreKeyProvider.ts',
      'src/resources/SecretStoreResource.ts',
      'src/resources/fn.actor-resource-key-value.ts',
      'src/resources/fn.resource-data.ts',
      'src/resources/resource-types.ts',
    ]
    for (const path of retiredFiles) {
      expect(
        await stat(join(actorPackageRoot, path)).then(() => true).catch(() => false),
        `${path} must stay retired`,
      ).toBe(false)
    }

    const packageJson = JSON.parse(
      await readFile(join(actorPackageRoot, 'package.json'), 'utf8'),
    ) as { exports: Record<string, string> }
    expect(packageJson.exports['./*']).toBeUndefined()
    expect(Object.keys(packageJson.exports).sort()).toEqual([
      '.',
      './Actor',
      './core/fn.normalize-actor-manifest',
      './core/types',
      './core/vibecanvasjson.zod',
      './icp-client',
      './legacy/resource-protocol',
    ])

    const protocol = await readFile(
      join(actorPackageRoot, 'src/legacy/resource-protocol.ts'),
      'utf8',
    )
    expect(protocol).not.toContain('@vibecanvas/service-db')
    expect(protocol).not.toMatch(/\b(?:Provider|Persistence|Manager|Draft|Apply|Backup|Restore)\b/)
  })
})
