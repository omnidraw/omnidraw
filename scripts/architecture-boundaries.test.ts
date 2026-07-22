import { describe, expect, test } from 'bun:test'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'
import {
  createServiceRegistry,
  type ICollaborationService,
  type IScopedEventBus,
  type IService,
  type IServiceRegistry,
} from '../packages/runtime/src'
import type { IAutomergeService } from '../packages/service-automerge/src/IAutomergeService'
import { EventPublisherService } from '../packages/service-event-publisher/src/EventPublisherService'
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

declare module '../packages/runtime/src/interface' {
  interface IServiceMap {
    localCollaboration: ICollaborationService & IService
    localEvents: IScopedEventBus<unknown> & IService
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
  return [
    ...[...declarations].map((match) => match[1]!),
    ...[...dynamicImports].map((match) => match[1]!),
  ]
}

function publicPackageName(specifier: string): string | null {
  if (!specifier.startsWith('@vibecanvas/')) return null
  return specifier.split('/').slice(0, 2).join('/')
}

async function sourceFiles(directory: string): Promise<string[]> {
  return (await listFiles(directory)).filter((path) => ['.ts', '.tsx'].includes(extname(path)))
}

describe('managed composition architecture boundaries', () => {
  test('structurally registers local collaboration and event adapters through public seams', () => {
    const services = createServiceRegistry()
    const events: IScopedEventBus<unknown> & IService = new EventPublisherService()
    services.provide('localEvents', 20, events)

    expect(services.require('localEvents')).toBe(events)
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
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      for (const specifier of moduleSpecifiers(source)) {
        if (specifier === 'bun:test') continue
        if (specifier.startsWith('.')) {
          expect(specifier.startsWith('..'), `${relative(ROOT, file)} escapes its fixture`).toBe(false)
          continue
        }
        expect(allowedPackages.has(specifier), `${relative(ROOT, file)} imports ${specifier}`).toBe(true)
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
