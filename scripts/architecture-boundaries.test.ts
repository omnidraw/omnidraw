import { describe, expect, test } from 'bun:test'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import {
  APPLICATION_DIRECTORIES,
  EXACT_QUALIFICATION_VERSIONS,
  PUBLIC_PACKAGE_DIRECTORIES,
  PUBLIC_PACKAGE_NAMES,
  assertFinalWorkspaceSurface,
  readPublicPackageSet,
  readQualifiedPublicPackages,
} from './public-packages'

const ROOT = resolve(import.meta.dir, '..')

async function readTsconfig(path: string): Promise<Record<string, any>> {
  const source = await readFile(path, 'utf8')
  return JSON.parse(source.replace(/^\s*\/\/.*$/gm, '')) as Record<string, any>
}
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
const APPLICATION_SOURCE_DIRECTORIES = new Set(['core', 'shell', 'sim', 'conformance'])
const FORBIDDEN_APPLICATION_OWNERSHIP_DIRECTORIES = new Set(['plugins', 'private', 'services'])
const APPLICATION_SOURCE_FILE_EXCEPTIONS = Object.freeze({
  'apps/backend': new Set(['index.ts', 'main.ts']),
  'apps/frontend': new Set(['index.css', 'index.ts', 'index.tsx']),
} satisfies Record<string, ReadonlySet<string>>)
const PUBLIC_NAMES = new Set<string>(PUBLIC_PACKAGE_NAMES)
const FINAL_OMNIDRAW_NAMES = new Set<string>([
  ...PUBLIC_PACKAGE_NAMES,
  '@omnidraw/backend',
  '@omnidraw/frontend',
  '@omnidraw/cangine',
  '@omnidraw/capsule',
])
const ALLOWED_PUBLIC_DEPENDENCIES = Object.freeze({
  '@omnidraw/canvas-contract': new Set<string>(),
  '@omnidraw/canvas': new Set(['@omnidraw/canvas-contract', '@omnidraw/theme', '@omnidraw/cangine']),
  '@omnidraw/sdk': new Set(['@omnidraw/capsule']),
  '@omnidraw/component-ai-chat': new Set(['@omnidraw/canvas']),
  '@omnidraw/theme': new Set<string>(),
} satisfies Record<string, ReadonlySet<string>>)
const SIDE_EFFECTFUL_PUBLIC_PACKAGES = new Set([
  '@omnidraw/canvas',
  '@omnidraw/sdk',
  '@omnidraw/component-ai-chat',
])
const FORBIDDEN_DIRECT_DEPENDENCIES = new Set([
  ['@orpc', 'client'].join('/'),
  ['@orpc', 'contract'].join('/'),
  ['@orpc', 'server'].join('/'),
  ['party', 'socket'].join(''),
  ['w', 's'].join(''),
])
const FORBIDDEN_MANAGED_WIDGET_PACKAGES = new Set([
  'cloudflare',
  'miniflare',
  'workerd',
  'wrangler',
  '@libsql/client',
  '@tursodatabase/serverless',
])
const OSS_WIDGET_ADAPTER_DIRECTORIES = Object.freeze([
  'apps/backend/src/shell/function-execution',
  'apps/backend/src/shell/resources/local',
])
const RETIRED_OMNIDRAW_NAMES = new Set([
  'api',
  'capsule-omnidraw',
  'function-runtime',
  'orpc-client',
  'resource-runtime',
  'runtime',
  'service-agent',
  'service-canvas',
  'service-db',
  'service-event-publisher',
  'service-kv',
  'service-theme',
  'service-widget-state',
  'shared-functions',
  'tapable',
  'tenant-core',
  'theme-contract',
  'ui-ai-chat',
  'widget-contract',
].map((name) => `@omnidraw/${name}`))

type TManifest = Record<string, unknown> & {
  name?: string
  version?: string
  private?: boolean
  workspaces?: readonly string[]
  scripts?: Record<string, string>
  catalog?: Record<string, string>
  overrides?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  exports?: unknown
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function readJson(path: string): Promise<TManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as TManifest
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') return []
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listFiles(path)
    return entry.isFile() ? [path] : []
  }))
  return nested.flat().sort()
}

async function listDirectories(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
      return []
    }
    const path = join(directory, entry.name)
    return [path, ...await listDirectories(path)]
  }))
  return nested.flat().sort()
}

async function sourceFiles(directory: string): Promise<string[]> {
  return (await listFiles(directory)).filter((path) => SOURCE_EXTENSIONS.has(extname(path)))
}

async function applicationSourceTopology(directory: string): Promise<Readonly<{
  directories: readonly string[]
  files: readonly string[]
}>> {
  const entries = await readdir(join(ROOT, directory, 'src'), { withFileTypes: true })
  return Object.freeze({
    directories: entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(),
    files: entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort(),
  })
}

function moduleSpecifiers(source: string): readonly string[] {
  return [
    ...[...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^;'"`]+?\s+from\s+)?['"]([^'"]+)['"]/g)]
      .map((match) => match[1]!),
    ...[...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]!),
    ...[...source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]!),
  ]
}

function packageName(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#')) return null
  if (/^(?:bun|data|node):/.test(specifier)) return null
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0] ?? null
}

function managedCloudImplementationImport(specifier: string): boolean {
  const normalizedSpecifier = specifier.toLowerCase()
  const imported = packageName(normalizedSpecifier)
  return normalizedSpecifier === 'cloudflare:workers'
    || normalizedSpecifier.startsWith('@cloudflare/')
    || (imported !== null && FORBIDDEN_MANAGED_WIDGET_PACKAGES.has(imported))
}

function managedWidgetImplementationImport(specifier: string): boolean {
  const normalizedSpecifier = specifier.toLowerCase()
  return managedCloudImplementationImport(specifier)
    || /(?:^|[/_.-])(?:tenant|billing|metering|authentication|managed-policy)(?:$|[/_.-])/.test(normalizedSpecifier)
}

function dependencyGroups(manifest: TManifest): readonly Record<string, string>[] {
  return [
    manifest.dependencies ?? {},
    manifest.optionalDependencies ?? {},
    manifest.peerDependencies ?? {},
    manifest.devDependencies ?? {},
  ]
}

function dependencies(manifest: TManifest): ReadonlyMap<string, string> {
  return new Map(dependencyGroups(manifest).flatMap((group) => Object.entries(group)))
}

function exportedTargets(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(exportedTargets)
  if (value === null || typeof value !== 'object') return []
  return Object.values(value).flatMap(exportedTargets)
}

function normalized(path: string): string {
  return path.split(sep).join('/')
}

function isTestSource(path: string): boolean {
  const value = normalized(path)
  return /(?:^|\/)tests?(?:\/|$)|\.(?:spec|test)\.[cm]?[jt]sx?$/.test(value)
}

describe('final repository surface', () => {
  test('contains exactly two private apps and five qualified public packages', async () => {
    await assertFinalWorkspaceSurface(ROOT)
    const packageSet = await readPublicPackageSet(ROOT)
    const packages = await readQualifiedPublicPackages(ROOT)
    expect(packages).toHaveLength(5)
    expect(new Set(packages.map((entry) => entry.name))).toEqual(new Set(PUBLIC_PACKAGE_NAMES))
    expect(packageSet.qualification).toEqual(EXACT_QUALIFICATION_VERSIONS)
  })

  test('keeps tooling and isolated consumers out of the workspace product surface', async () => {
    const rootManifest = await readJson(join(ROOT, 'package.json'))
    expect(rootManifest.workspaces).toEqual(['apps/*', 'packages/*'])
    for (const fixture of ['external-composition', 'canvas-consumer']) {
      const manifest = await readJson(join(ROOT, 'tests/fixtures', fixture, 'package.json'))
      expect(manifest.private).toBe(true)
      expect(manifest.version).toBeUndefined()
    }
    for (const removed of [
      'global.d.ts',
      'FILES.md',
      'scripts/generate-files-md.ts',
      'scripts/eslint-tooling',
    ]) {
      expect(await exists(join(ROOT, removed)), removed).toBe(false)
    }
  })

  test('root commands select only the two apps and five packages', async () => {
    const manifest = await readJson(join(ROOT, 'package.json'))
    const scripts = manifest.scripts ?? {}
    const selected = [...(scripts['test:workspace'] ?? '').matchAll(/--filter\s+'([^']+)'/g)]
      .map((match) => match[1]!)
    expect(selected).toEqual([
      '@omnidraw/backend',
      '@omnidraw/frontend',
      '@omnidraw/canvas-contract',
      '@omnidraw/canvas',
      '@omnidraw/sdk',
      '@omnidraw/component-ai-chat',
      '@omnidraw/theme',
    ])
    expect(scripts['test:workspace']).not.toContain("--filter '*'")
    expect(scripts.test).toContain('test:typecheck')
    expect(scripts['test:typecheck']).not.toContain("--filter '*'")
    expect([...(scripts['test:typecheck'] ?? '').matchAll(/--filter\s+'([^']+)'/g)]
      .map((match) => match[1]!)).toEqual(selected)
    expect(scripts['test:conformance']).toContain('test:backend:conformance')
    expect(scripts['test:conformance']).toContain('test:frontend:conformance')
    expect(scripts['test:frontend:conformance']).toContain('apps/frontend/src/conformance')
    expect(scripts['test:frontend:conformance']).toContain('apps/frontend/src/sim')
    expect(scripts['pretest:architecture']).toBe('bun run build:public')
    expect(scripts['build:public']).toContain('packages/component-ai-chat')
    expect(scripts['test:packed-public-composition']).toContain('test-packed-public-composition.ts')
    expect(scripts['test:browser']).toContain('test-packed-canvas.ts')

    const nonDatabaseScripts = Object.entries(scripts)
      .filter(([name]) => !name.startsWith('db:') && name !== 'test:db')
      .map(([name, command]) => `${name}: ${command}`)
      .join('\n')
    for (const retired of RETIRED_OMNIDRAW_NAMES) expect(nonDatabaseScripts).not.toContain(retired)
    for (const removedPath of ['apps/cli', 'capsule-browser-acceptance', 'preview-inspection-shell', 'widget-debug-tools']) {
      expect(nonDatabaseScripts).not.toContain(removedPath)
    }
  })
})

describe('public package release graph', () => {
  test('matches the qualified versions and fixed dependency ownership', async () => {
    const entries = await readQualifiedPublicPackages(ROOT)
    const manifests = new Map(entries.map((entry) => [entry.name, entry.manifest]))
    for (const entry of entries) {
      const all = dependencies(entry.manifest)
      expect(entry.manifest.private).not.toBe(true)
      expect(entry.manifest.exports).toBeDefined()
      expect(all.has('zod'), `${entry.name} declares Zod`).toBe(false)
      for (const dependency of all.keys()) {
        if (!dependency.startsWith('@omnidraw/')) continue
        expect(
          ALLOWED_PUBLIC_DEPENDENCIES[entry.name].has(dependency),
          `${entry.name} declares non-public dependency ${dependency}`,
        ).toBe(true)
      }
      if (SIDE_EFFECTFUL_PUBLIC_PACKAGES.has(entry.name)) {
        expect(entry.manifest.dependencies?.effect).toBe(EXACT_QUALIFICATION_VERSIONS.effect)
      } else {
        expect(all.has('effect'), `${entry.name} must stay pure`).toBe(false)
      }
    }

    expect(manifests.get('@omnidraw/sdk')?.dependencies?.['@omnidraw/capsule'])
      .toBe(EXACT_QUALIFICATION_VERSIONS['@omnidraw/capsule'])
    expect(manifests.get('@omnidraw/canvas')?.dependencies?.['@omnidraw/cangine'])
      .toBe(EXACT_QUALIFICATION_VERSIONS['@omnidraw/cangine'])
    for (const name of ['@omnidraw/canvas', '@omnidraw/component-ai-chat'] as const) {
      const manifest = manifests.get(name)!
      expect(manifest.dependencies?.['solid-js']).toBeUndefined()
      expect(manifest.dependencies?.['@solidjs/web']).toBeUndefined()
      expect(manifest.peerDependencies?.['solid-js']).toBe(EXACT_QUALIFICATION_VERSIONS['solid-js'])
      expect(manifest.peerDependencies?.['@solidjs/web']).toBe(EXACT_QUALIFICATION_VERSIONS['@solidjs/web'])
      expect(manifest.devDependencies?.['solid-js']).toBe('catalog:')
      expect(manifest.devDependencies?.['@solidjs/web']).toBe('catalog:')
    }
  })

  test('keeps the migrated browser surfaces free of Solid 1 source forms', async () => {
    const violations: string[] = []
    const root = await readJson(join(ROOT, 'package.json'))
    expect(root.catalog).toMatchObject({
      '@solidjs/router': EXACT_QUALIFICATION_VERSIONS['@solidjs/router'],
      '@solidjs/signals': EXACT_QUALIFICATION_VERSIONS['@solidjs/signals'],
      '@solidjs/vite-plugin': EXACT_QUALIFICATION_VERSIONS['@solidjs/vite-plugin'],
      '@solidjs/web': EXACT_QUALIFICATION_VERSIONS['@solidjs/web'],
      'babel-preset-solid': EXACT_QUALIFICATION_VERSIONS['babel-preset-solid'],
      'solid-js': EXACT_QUALIFICATION_VERSIONS['solid-js'],
    })
    expect(root.overrides?.['babel-preset-solid'])
      .toBe(EXACT_QUALIFICATION_VERSIONS['babel-preset-solid'])
    const frontend = await readJson(join(ROOT, 'apps/frontend/package.json'))
    expect(frontend.dependencies).toMatchObject({
      '@solidjs/router': 'catalog:',
      '@solidjs/web': 'catalog:',
      'solid-js': 'catalog:',
    })
    expect(frontend.devDependencies?.['@solidjs/vite-plugin']).toBe('catalog:')
    expect(frontend.devDependencies?.['solid-devtools']).toBeUndefined()
    expect(frontend.dependencies?.['lucide-solid']).toBeUndefined()
    expect(frontend.dependencies?.['@kobalte/core']).toBeUndefined()
    expect(root.catalog?.['@kobalte/core']).toBeUndefined()
    const lock = await readFile(join(ROOT, 'bun.lock'), 'utf8')
    for (const qualified of [
      'solid-js',
      '@solidjs/signals',
      '@solidjs/web',
      '@solidjs/router',
      '@solidjs/vite-plugin',
      'babel-preset-solid',
    ] as const) {
      const escaped = qualified.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const resolvedVersions = new Set(
        [...lock.matchAll(new RegExp(`${escaped}@(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)`, 'g'))]
          .map((match) => match[1]!),
      )
      expect([...resolvedVersions], `${qualified} lockfile versions`).toEqual([
        EXACT_QUALIFICATION_VERSIONS[qualified],
      ])
    }
    expect(lock).not.toContain('solid-devtools')
    expect(lock).not.toContain('lucide-solid')
    expect(lock).not.toContain('@kobalte/core')
    expect(lock).not.toMatch(/(?:^|["'])vite-plugin-solid(?:["'@:]|$)/m)
    for (const config of [
      'apps/frontend/vite.config.ts',
      'apps/frontend/vite.inspection.config.ts',
      'apps/frontend/vitest.config.ts',
      'packages/canvas/vite.config.ts',
      'packages/canvas/vitest.config.ts',
      'packages/component-ai-chat/vite.config.ts',
      'packages/component-ai-chat/vitest.config.ts',
      'tests/fixtures/canvas-consumer/vite.config.ts',
    ]) {
      expect(await readFile(join(ROOT, config), 'utf8'), config).toMatch(
        /solid\(?(?:Plugin)?\(\{\s*solid:\s*\{\s*moduleName:\s*["']@solidjs\/web["']\s*\}\s*\}\)/,
      )
    }
    const migratedRoots = [
      'apps/frontend',
      'packages/canvas',
      'packages/component-ai-chat',
    ]
    const forbidden = [
      [/(?:^|['"])(solid-js\/(?:web|store|jsx-runtime|jsx-dev-runtime))\b/, 'legacy Solid subpath'],
      [/"jsxImportSource"\s*:\s*"solid-js"/, 'Solid-owned JSX runtime'],
      [/\bon:[A-Za-z][\w-]*\s*=/, 'legacy namespaced JSX event'],
      [/\bclassList\s*=/, 'legacy JSX classList binding'],
      [/\bonMount\b/, 'removed onMount lifecycle'],
      [/<[A-Za-z_$][\w$]*\.Provider\b/, 'legacy context Provider element'],
      [/\b(?:lucide-solid|solid-devtools|vite-plugin-solid)\b/, 'Solid 1-only dependency or tool'],
    ] as const

    for (const directory of migratedRoots) {
      for (const file of await sourceFiles(join(ROOT, directory))) {
        const source = await readFile(file, 'utf8')
        for (const [pattern, label] of forbidden) {
          if (pattern.test(source)) violations.push(`${relative(ROOT, file)} contains ${label}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  test('installs one compiler, router, and runtime graph with compatible Solid RC peers', async () => {
    const frontendRoot = join(ROOT, 'apps/frontend')
    const pluginRoot = await realpath(join(frontendRoot, 'node_modules/@solidjs/vite-plugin'))
    const routerRoot = await realpath(join(frontendRoot, 'node_modules/@solidjs/router'))
    const plugin = await readJson(join(pluginRoot, 'package.json'))
    const router = await readJson(join(routerRoot, 'package.json'))
    const presetPath = Bun.resolveSync('babel-preset-solid/package.json', pluginRoot)
    const pluginCorePath = Bun.resolveSync('solid-js/package.json', pluginRoot)
    const pluginWebPath = Bun.resolveSync('@solidjs/web/package.json', pluginRoot)
    const presetCorePath = Bun.resolveSync('solid-js/package.json', dirname(presetPath))
    const routerCorePath = Bun.resolveSync('solid-js/package.json', routerRoot)
    const routerWebPath = Bun.resolveSync('@solidjs/web/package.json', routerRoot)
    const signalsPath = Bun.resolveSync('@solidjs/signals/package.json', dirname(pluginCorePath))
    const [preset, pluginCore, pluginWeb, presetCore, routerCore, routerWeb, signals] = await Promise.all([
      readJson(presetPath),
      readJson(pluginCorePath),
      readJson(pluginWebPath),
      readJson(presetCorePath),
      readJson(routerCorePath),
      readJson(routerWebPath),
      readJson(signalsPath),
    ])

    expect(plugin.version).toBe(EXACT_QUALIFICATION_VERSIONS['@solidjs/vite-plugin'])
    expect(plugin.dependencies?.['babel-preset-solid']).toBe('^2.0.0-rc.0')
    expect(plugin.peerDependencies?.['solid-js']).toBe('^2.0.0-rc.0')
    expect(plugin.peerDependencies?.['@solidjs/web']).toBe('^2.0.0-rc.0')
    expect(preset.version).toBe(EXACT_QUALIFICATION_VERSIONS['babel-preset-solid'])
    expect(preset.peerDependencies?.['solid-js']).toBe('^2.0.0-rc.0')
    expect(preset.dependencies?.['@dom-expressions/babel-plugin-jsx']).toBe('0.50.0-next.42')
    expect(router.version).toBe(EXACT_QUALIFICATION_VERSIONS['@solidjs/router'])
    expect(router.peerDependencies?.['solid-js']).toBe('^2.0.0-rc.0')
    expect(router.peerDependencies?.['@solidjs/web']).toBe('^2.0.0-rc.0')
    for (const core of [pluginCore, presetCore, routerCore]) {
      expect(core.version).toBe(EXACT_QUALIFICATION_VERSIONS['solid-js'])
    }
    for (const web of [pluginWeb, routerWeb]) {
      expect(web.version).toBe(EXACT_QUALIFICATION_VERSIONS['@solidjs/web'])
    }
    expect(signals.version).toBe(EXACT_QUALIFICATION_VERSIONS['@solidjs/signals'])
  })

  test('has an acyclic internal graph', async () => {
    const entries = await readQualifiedPublicPackages(ROOT)
    const graph = new Map(entries.map((entry) => [
      entry.name,
      [...dependencies(entry.manifest).keys()].filter((name) => PUBLIC_NAMES.has(name)),
    ]))
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (name: string): void => {
      if (visiting.has(name)) throw new Error(`Public package dependency cycle at ${name}.`)
      if (visited.has(name)) return
      visiting.add(name)
      for (const dependency of graph.get(name as keyof typeof PUBLIC_PACKAGE_DIRECTORIES) ?? []) {
        visit(dependency)
      }
      visiting.delete(name)
      visited.add(name)
    }
    for (const name of graph.keys()) visit(name)
    expect(visited.size).toBe(5)
  })

  test('keeps AI Chat approval policy transport-neutral and chat-scoped', async () => {
    const publicContract = await readFile(
      join(ROOT, 'packages/component-ai-chat/src/contracts.ts'),
      'utf8',
    )
    expect(publicContract).toContain('approvalPolicy: TAiChatApprovalPolicy')
    expect(publicContract).not.toMatch(/(?:from\s+|import\s*\()["'](?:effect|@\/|#backend|@omnidraw\/(?:backend|frontend))/)

    const settings = await readFile(
      join(ROOT, 'packages/component-ai-chat/src/chat/components/tabs/SettingsTab.tsx'),
      'utf8',
    )
    expect(settings).not.toContain('setApprovalPolicy')
    expect(settings).not.toContain('approvalPolicy')
    expect(await exists(join(ROOT, 'apps/backend/src/shell/agent/approval/ApprovalPolicyStore.ts'))).toBe(false)
    expect(await exists(join(ROOT, 'apps/backend/src/shell/api/agent/api.setting.approvalPolicy.update.ts'))).toBe(false)

    const agent = await readFile(join(ROOT, 'apps/backend/src/shell/agent/AgentService.ts'), 'utf8')
    expect(agent).toContain('#chatApprovalPolicies = new Map')
    expect(agent).toContain('#chatApprovalPolicies.delete(sessionId)')
    const privateContract = await readFile(
      join(ROOT, 'apps/frontend/src/core/app/private-operation-contract.ts'),
      'utf8',
    )
    expect(privateContract).toContain('"agent.chat.approvalPolicy.update"')
    expect(privateContract).not.toContain('"agent.setting.approvalPolicy.update"')
  })

  test('stages standalone manifests with exact internal versions', async () => {
    const packageSet = await readPublicPackageSet(ROOT)
    for (const [name, directory] of Object.entries(PUBLIC_PACKAGE_DIRECTORIES)) {
      const dist = join(ROOT, directory, 'dist')
      const manifest = await readJson(join(dist, 'package.json'))
      expect(manifest.name).toBe(name)
      expect(manifest.version).toBe(packageSet.packages[name as keyof typeof packageSet.packages])
      const text = JSON.stringify(manifest)
      expect(text).not.toMatch(/(?:workspace|catalog|file|link):/)
      for (const group of dependencyGroups(manifest)) {
        for (const [dependency, version] of Object.entries(group)) {
          const qualified = packageSet.packages[dependency as keyof typeof packageSet.packages]
          if (qualified !== undefined) expect(version).toBe(qualified)
        }
      }
      for (const target of exportedTargets(manifest.exports)) {
        if (target.includes('*')) continue
        const absolute = resolve(dist, target)
        expect(absolute.startsWith(`${dist}${sep}`), `${name} export escapes dist`).toBe(true)
        expect(await exists(absolute), `${name} is missing ${target}`).toBe(true)
      }
      for (const declaration of (await listFiles(dist)).filter((path) => path.endsWith('.d.ts'))) {
        const source = await readFile(declaration, 'utf8')
        expect(source, normalized(relative(ROOT, declaration))).not.toMatch(
          /(?:from\s+|import\s*\()['"](?:effect|zod|@omnidraw\/capsule|@omnidraw\/cangine|@omnidraw\/(?:backend|frontend))\b/,
        )
        if (name === '@omnidraw/canvas' || name === '@omnidraw/component-ai-chat') {
          expect(source, normalized(relative(ROOT, declaration))).not.toMatch(
            /solid-js\/(?:web|store|jsx-runtime|jsx-dev-runtime)|import\(["']solid-js["']\)\.JSX|import\s+type\s+\{[^}]*\bJSX\b[^}]*\}\s+from\s+["']solid-js["']/,
          )
        }
      }
      if (name === '@omnidraw/canvas' || name === '@omnidraw/component-ai-chat') {
        for (const output of (await listFiles(dist)).filter((path) => path.endsWith('.js'))) {
          expect(await readFile(output, 'utf8'), normalized(relative(ROOT, output))).not.toMatch(
            /solid-js\/(?:web|store|jsx-runtime|jsx-dev-runtime)/,
          )
        }
      }
    }
  })
})

describe('application and import boundaries', () => {
  test('keeps managed cloud and policy implementations outside portable and OSS widget adapters', async () => {
    const violations: string[] = []
    const manifestDirectories = [
      ...Object.values(PUBLIC_PACKAGE_DIRECTORIES),
      'apps/backend',
    ]
    for (const directory of manifestDirectories) {
      const manifest = await readJson(join(ROOT, directory, 'package.json'))
      for (const dependency of dependencies(manifest).keys()) {
        if (managedWidgetImplementationImport(dependency)) {
          violations.push(`${directory}/package.json declares managed widget dependency ${dependency}`)
        }
      }
    }

    const sourceRoots = [
      ...Object.values(PUBLIC_PACKAGE_DIRECTORIES).map((directory) => join(ROOT, directory, 'src')),
      ...OSS_WIDGET_ADAPTER_DIRECTORIES.map((directory) => join(ROOT, directory)),
    ]
    for (const sourceRoot of sourceRoots) {
      for (const file of await sourceFiles(sourceRoot)) {
        const source = await readFile(file, 'utf8')
        for (const specifier of moduleSpecifiers(source)) {
          if (managedWidgetImplementationImport(specifier)) {
            violations.push(`${relative(ROOT, file)} imports managed widget implementation ${specifier}`)
          }
        }
      }
    }

    for (const file of await sourceFiles(join(ROOT, 'apps/backend/src'))) {
      if (isTestSource(file)) continue
      const source = await readFile(file, 'utf8')
      for (const specifier of moduleSpecifiers(source)) {
        if (
          managedCloudImplementationImport(specifier)
          || /(?:^|[/_.-])(?:workers-for-platforms|remote-turso|managed-widget|managed-policy)(?:$|[/_.-])/.test(specifier.toLowerCase())
        ) {
          violations.push(`${relative(ROOT, file)} imports managed cloud widget implementation ${specifier}`)
        }
      }
      if (/(?:CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)|TURSO_(?:DATABASE_URL|AUTH_TOKEN)|libsql:\/\/)/.test(source)) {
        violations.push(`${relative(ROOT, file)} contains a managed cloud credential or remote database path`)
      }
    }

    const backendManifest = await readJson(join(ROOT, 'apps/backend/package.json'))
    expect(backendManifest.dependencies?.['@tursodatabase/database']).toBe('catalog:')
    expect(violations).toEqual([])
  })

  test('allows only core, shell, sim, conformance, and tiny source entry exceptions', async () => {
    for (const directory of APPLICATION_DIRECTORIES) {
      const topology = await applicationSourceTopology(directory)
      expect(
        topology.directories,
        `${directory}/src contains non-architectural ownership buckets`,
      ).toEqual([...APPLICATION_SOURCE_DIRECTORIES].sort())
      const exceptions = APPLICATION_SOURCE_FILE_EXCEPTIONS[directory] ?? new Set<string>()
      expect(
        topology.files.filter((file) => !exceptions.has(file)),
        `${directory}/src contains implementation outside core/shell/sim/conformance`,
      ).toEqual([])
      const nestedLayerAliases = (await listDirectories(join(ROOT, directory, 'src')))
        .filter((path) => {
          const relativePath = normalized(relative(join(ROOT, directory, 'src'), path))
          return relativePath.includes('/')
            && APPLICATION_SOURCE_DIRECTORIES.has(relativePath.split('/').at(-1) ?? '')
        })
        .map((path) => normalized(relative(ROOT, path)))
      expect(
        nestedLayerAliases,
        `${directory}/src contains nested pseudo-layer directories`,
      ).toEqual([])
      const retiredOwnershipBuckets = (await listDirectories(join(ROOT, directory, 'src')))
        .filter((path) => FORBIDDEN_APPLICATION_OWNERSHIP_DIRECTORIES.has(path.split(sep).at(-1) ?? ''))
        .map((path) => normalized(relative(ROOT, path)))
      expect(
        retiredOwnershipBuckets,
        `${directory}/src contains retired private/services/plugins ownership buckets`,
      ).toEqual([])
    }

    expect(await exists(join(ROOT, 'apps/backend/src/index.ts'))).toBe(true)
    const backendManifest = await readJson(join(ROOT, 'apps/backend/package.json'))
    expect(backendManifest.exports).not.toEqual({ './*': './src/*' })
  })

  test('uses exact Effect and no retired transport dependency', async () => {
    const root = await readJson(join(ROOT, 'package.json'))
    expect(root.catalog?.effect).toBe(EXACT_QUALIFICATION_VERSIONS.effect)
    for (const directory of APPLICATION_DIRECTORIES) {
      const manifest = await readJson(join(ROOT, directory, 'package.json'))
      expect(manifest.private).toBe(true)
      expect(manifest.version).toBeUndefined()
      expect(
        manifest.dependencies?.effect === 'catalog:'
          ? root.catalog?.effect
          : manifest.dependencies?.effect,
      ).toBe(EXACT_QUALIFICATION_VERSIONS.effect)
      for (const group of dependencyGroups(manifest)) {
        for (const dependency of Object.keys(group)) {
          expect(FORBIDDEN_DIRECT_DEPENDENCIES.has(dependency), `${directory} depends on ${dependency}`).toBe(false)
          if (dependency.startsWith('@omnidraw/')) {
            expect(
              FINAL_OMNIDRAW_NAMES.has(dependency),
              `${directory} depends on retired ${dependency}`,
            ).toBe(true)
          }
        }
      }
    }
    for (const dependency of FORBIDDEN_DIRECT_DEPENDENCIES) {
      expect(root.catalog?.[dependency]).toBeUndefined()
    }
  })

  test('source-run applications map only supported public entrypoints away from mutable dist outputs', async () => {
    const backend = await readTsconfig(join(ROOT, 'apps/backend/tsconfig.json'))
    const frontend = await readTsconfig(join(ROOT, 'apps/frontend/tsconfig.json'))
    const backendPaths = (backend.compilerOptions?.paths ?? {}) as Record<string, readonly string[]>
    const frontendPaths = (frontend.compilerOptions?.paths ?? {}) as Record<string, readonly string[]>
    expect(Object.keys(backendPaths).filter((key) => key.startsWith('@omnidraw/')).sort()).toEqual([
      '@omnidraw/canvas-contract',
      '@omnidraw/canvas-contract/CONSTANTS',
      '@omnidraw/canvas-contract/types',
      '@omnidraw/sdk',
      '@omnidraw/sdk/conformance',
      '@omnidraw/sdk/contract',
      '@omnidraw/sdk/package.json',
      '@omnidraw/sdk/server',
      '@omnidraw/sdk/widget',
    ])
    expect(Object.keys(frontendPaths).filter((key) => key.startsWith('@omnidraw/')).sort()).toEqual([
      '@omnidraw/canvas',
      '@omnidraw/canvas-contract',
      '@omnidraw/canvas-contract/CONSTANTS',
      '@omnidraw/component-ai-chat',
      '@omnidraw/component-ai-chat/canvas-frame',
      '@omnidraw/sdk',
      '@omnidraw/sdk/host',
      '@omnidraw/theme',
    ])
    for (const paths of [backendPaths, frontendPaths]) {
      expect(Object.keys(paths).some((key) => key.startsWith('@omnidraw/') && key.includes('*'))).toBe(false)
      for (const [specifier, targets] of Object.entries(paths)) {
        if (!specifier.startsWith('@omnidraw/')) continue
        expect(targets).toHaveLength(1)
        expect(targets[0]).not.toContain('/dist/')
      }
    }
    const vite = await readFile(join(ROOT, 'apps/frontend/vite.config.ts'), 'utf8')
    expect(vite).toContain('omnidraw-source-theme-css')
    expect(vite).toContain("packages/canvas/src/styles.css")
    expect(vite).toContain("packages/component-ai-chat/src/styles.css")
    expect(vite).not.toMatch(/find:\s*\/\^@omnidraw\\\/.+\.\*\//)

    for (const directory of Object.values(PUBLIC_PACKAGE_DIRECTORIES)) {
      const manifest = await readJson(join(ROOT, directory, 'package.json'))
      for (const target of exportedTargets(manifest.exports)) {
        if (target.includes('*') || !target.endsWith('.js')) continue
        expect(target, `${manifest.name} external exports must remain dist-owned`).toContain('./dist/')
      }
    }
  })

  test('AI Chat dev typechecking resolves Canvas source without changing release resolution', async () => {
    const dev = await readTsconfig(join(ROOT, 'packages/component-ai-chat/tsconfig.dev.json'))
    const devPaths = (dev.compilerOptions?.paths ?? {}) as Record<string, readonly string[]>
    expect(dev.extends).toBe('./tsconfig.json')
    expect(devPaths).toEqual({
      '@omnidraw/canvas': ['../canvas/src/index.ts'],
      '@omnidraw/canvas-contract': ['../canvas-contract/src/index.ts'],
      '@omnidraw/canvas-contract/CONSTANTS': ['../canvas-contract/src/CONSTANTS.ts'],
      '@omnidraw/theme': ['../theme/src/index.ts'],
    })

    const regular = await readTsconfig(join(ROOT, 'packages/component-ai-chat/tsconfig.json'))
    const build = await readTsconfig(join(ROOT, 'packages/component-ai-chat/tsconfig.build.json'))
    expect(regular.compilerOptions?.paths).toBeUndefined()
    expect(build.compilerOptions?.paths).toBeUndefined()

    const devFrontend = await readFile(join(ROOT, 'scripts/dev-frontend.ts'), 'utf8')
    expect(devFrontend).toContain('"tsconfig.dev.json"')
    expect(devFrontend).not.toContain('"tsconfig.build.json", "--watch"')
  })

  test('Canvas dev declarations resolve Canvas Contract source without changing release resolution', async () => {
    const dev = await readTsconfig(join(ROOT, 'packages/canvas/tsconfig.dev.json'))
    const devPaths = (dev.compilerOptions?.paths ?? {}) as Record<string, readonly string[]>
    expect(dev.extends).toBe('./tsconfig.build.json')
    expect(devPaths).toEqual({
      '@omnidraw/canvas-contract': ['../canvas-contract/src/index.ts'],
      '@omnidraw/canvas-contract/CONSTANTS': ['../canvas-contract/src/CONSTANTS.ts'],
      '@omnidraw/theme': ['../theme/src/index.ts'],
    })
    expect(dev.references).toEqual([
      { path: '../canvas-contract/tsconfig.dev.json' },
      { path: '../theme/tsconfig.dev.json' },
    ])

    for (const dependency of ['canvas-contract', 'theme']) {
      const dependencyDev = await readTsconfig(join(ROOT, `packages/${dependency}/tsconfig.dev.json`))
      expect(dependencyDev.extends).toBe('./tsconfig.build.json')
      expect(dependencyDev.compilerOptions?.composite).toBe(true)
      expect(dependencyDev.compilerOptions?.emitDeclarationOnly).toBe(true)
      expect(dependencyDev.compilerOptions?.outDir).toBe('.dev-dist')
    }

    const regular = await readTsconfig(join(ROOT, 'packages/canvas/tsconfig.json'))
    const build = await readTsconfig(join(ROOT, 'packages/canvas/tsconfig.build.json'))
    expect(regular.compilerOptions?.paths).toBeUndefined()
    expect(build.compilerOptions?.paths).toBeUndefined()

    const devFrontend = await readFile(join(ROOT, 'scripts/dev-frontend.ts'), 'utf8')
    expect(devFrontend).toContain('name: "canvas-types"')
    expect(devFrontend).toContain('"-b", "tsconfig.dev.json"')
    expect(devFrontend).not.toContain('command: [bunExec, "run", "dev:types"]')
  })

  test('gates normal development on the isolated verified inspection distribution', async () => {
    const rootManifest = await readJson(join(ROOT, 'package.json'))
    const backendManifest = await readJson(join(ROOT, 'apps/backend/package.json'))
    const frontendManifest = await readJson(join(ROOT, 'apps/frontend/package.json'))
    expect(frontendManifest.scripts['build:inspection']).toContain('build-inspection.ts')
    expect(frontendManifest.scripts['dev:inspection']).toContain('build-inspection.ts --watch')
    expect(frontendManifest.scripts['dev:inspection:ready']).toContain('--watch --reuse-current')
    expect(frontendManifest.scripts.build).toBe('vite build && bun run build:inspection')
    expect(rootManifest.scripts.dev).toBe('bun run scripts/dev.ts')
    expect(rootManifest.scripts.predev).toBe('bun run build:public && bun run build:inspection')
    expect(rootManifest.scripts['preclient:dev']).toBe('bun run build:public && bun run build:inspection')
    expect(rootManifest.scripts['preserver:dev']).toBe('bun run build:inspection')
    expect(backendManifest.scripts.predev).toBe('bun run --cwd ../frontend build:inspection')

    const rootDev = await readFile(join(ROOT, 'scripts/dev.ts'), 'utf8')
    expect(rootDev).not.toContain('build:inspection')
    const frontendDev = await readFile(join(ROOT, 'scripts/dev-frontend.ts'), 'utf8')
    expect(frontendDev).toContain('"dev:inspection:ready"')
    expect(frontendDev.indexOf('await waitForInspectionReady(inspection)'))
      .toBeLessThan(frontendDev.indexOf('name: "canvas-contract"'))
    expect(frontendDev).toContain('name: "frontend"')
  })

  test('keeps public imports on their declared graph and all source off retired packages', async () => {
    const violations: string[] = []
    const roots = [
      ...APPLICATION_DIRECTORIES,
      ...Object.values(PUBLIC_PACKAGE_DIRECTORIES),
    ]
    for (const directory of roots) {
      const packageRoot = join(ROOT, directory)
      const sourceRoot = join(packageRoot, 'src')
      for (const file of await sourceFiles(sourceRoot)) {
        const source = await readFile(file, 'utf8')
        for (const specifier of moduleSpecifiers(source)) {
          const imported = packageName(specifier)
          if (imported !== null) {
            if (FORBIDDEN_DIRECT_DEPENDENCIES.has(imported)) {
              violations.push(`${relative(ROOT, file)} imports forbidden ${specifier}`)
            }
            if (RETIRED_OMNIDRAW_NAMES.has(imported)) {
              violations.push(`${relative(ROOT, file)} imports retired ${specifier}`)
            }
            if (specifier.includes('/src/')) {
              violations.push(`${relative(ROOT, file)} deep-imports ${specifier}`)
            }
            const applicationName = directory === 'apps/backend'
              ? '@omnidraw/backend'
              : directory === 'apps/frontend'
                ? '@omnidraw/frontend'
                : null
            if (applicationName !== null && imported === applicationName) {
              violations.push(`${relative(ROOT, file)} self-imports private application path ${specifier}`)
            }
            const publicName = Object.entries(PUBLIC_PACKAGE_DIRECTORIES)
              .find(([, value]) => directory === value)?.[0] as keyof typeof ALLOWED_PUBLIC_DEPENDENCIES | undefined
            if (
              publicName !== undefined
              && imported.startsWith('@omnidraw/')
              && !ALLOWED_PUBLIC_DEPENDENCIES[publicName].has(imported)
            ) {
              violations.push(`${relative(ROOT, file)} crosses public graph via ${specifier}`)
            }
          } else if (specifier.startsWith('.')) {
            const target = resolve(dirname(file), specifier)
            if (relative(packageRoot, target).startsWith('..')) {
              violations.push(`${relative(ROOT, file)} escapes its package via ${specifier}`)
            }
          }
        }
      }
    }
    expect(violations).toEqual([])
  })

  test('enforces core, shell, simulation, and lazy program ownership', async () => {
    const violations: string[] = []
    for (const application of APPLICATION_DIRECTORIES) {
      const sourceRoot = join(ROOT, application, 'src')
      for (const required of APPLICATION_SOURCE_DIRECTORIES) {
        expect(await exists(join(sourceRoot, required)), `${application} is missing ${required}/`).toBe(true)
      }
      for (const file of await sourceFiles(join(sourceRoot, 'core'))) {
        if (isTestSource(file)) continue
        const source = await readFile(file, 'utf8')
        const path = normalized(relative(ROOT, file))
        for (const specifier of moduleSpecifiers(source)) {
          if (/\/(?:shell|sim|conformance)(?:\/|$)/.test(specifier)) {
            violations.push(`${path} imports ${specifier}`)
          }
          if (
            /^(?:node:|bun:)|@tursodatabase|playwright|solid-js|@solidjs\//.test(specifier)
            || (
              application === 'apps/backend'
              && /^(?:@earendil-works\/|@omnidraw\/capsule(?:\/|$))/.test(specifier)
            )
          ) {
            violations.push(`${path} imports world or framework dependency ${specifier}`)
          }
        }
        if (/\b(?:Effect\.run(?:Promise|Sync|Fork)|ManagedRuntime|Bun\.|fetch\s*\(|new\s+WebSocket|window\.|document\.|localStorage\.)\b/.test(source)) {
          violations.push(`${path} executes or touches the world`)
        }
        if (/\b(?:Promise|AsyncIterable)\s*</.test(source)) {
          violations.push(`${path} exposes a native asynchronous contract instead of an Effect service`)
        }
        const basename = file.split(sep).at(-1)!
        if (/^(?:fx|tx)\./.test(basename)) {
          if (/export\s+async\s+(?:function|const)/.test(source)) {
            violations.push(`${path} exports an eager async program`)
          }
          if (/\bportal\b/.test(source)) {
            violations.push(`${path} retains a portal parameter or dependency`)
          }
          if (!/Effect\.(?:Effect|fn\.Return)\s*</.test(source)) {
            violations.push(`${path} does not declare an explicit Effect.Effect result`)
          }
          const namedPrograms = [...source.matchAll(
            /export\s+const\s+((?:fx|tx)[A-Z]\w*)\s*=\s*Effect\.fn\(\s*['"]([^'"]+)['"]\s*\)/g,
          )]
          if (namedPrograms.length === 0) {
            violations.push(`${path} does not export a named Effect.fn program`)
          }
          for (const program of namedPrograms) {
            if (program[1] !== program[2]) {
              violations.push(`${path} names ${program[1]} with Effect.fn span ${program[2]}`)
            }
          }
          if (/\bEffect\.gen\s*\(/.test(source)) {
            violations.push(`${path} wraps a core entrypoint in Effect.gen instead of Effect.fn`)
          }
        }
        if (/^fn\./.test(basename) && /from\s+['"]effect(?:\/|['"])/.test(source)) {
          violations.push(`${path} imports Effect in deterministic policy`)
        }
      }
      for (const file of await sourceFiles(join(sourceRoot, 'shell'))) {
        if (isTestSource(file)) continue
        const source = await readFile(file, 'utf8')
        for (const specifier of moduleSpecifiers(source)) {
          if (/\/(?:sim|conformance)(?:\/|$)/.test(specifier)) {
            violations.push(`${relative(ROOT, file)} imports ${specifier}`)
          }
        }
      }
      for (const file of await sourceFiles(join(sourceRoot, 'sim'))) {
        if (isTestSource(file)) continue
        const source = await readFile(file, 'utf8')
        if (/\b(?:Date\.now|Math\.random|crypto\.randomUUID|queueMicrotask|setTimeout|setInterval|fetch\s*\(|new\s+WebSocket|window\.|document\.|localStorage\.)\b/.test(source)) {
          violations.push(`${relative(ROOT, file)} uses uncontrolled simulation input`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  test('has one Effect-owned composition instead of service locators and portal programs', async () => {
    const violations: string[] = []
    for (const application of APPLICATION_DIRECTORIES) {
      let managedRuntimeCount = 0
      for (const file of await sourceFiles(join(ROOT, application, 'src'))) {
        if (isTestSource(file)) continue
        const source = await readFile(file, 'utf8')
        const path = normalized(relative(ROOT, file))
        if (!path.includes('/sim/') && !path.includes('/shell/cli/')) {
          managedRuntimeCount += [...source.matchAll(/\bManagedRuntime\.make\s*\(/g)].length
        }
        if (/\b(?:ServiceRegistry|services\.require|services\.provide)\b/.test(source)) {
          violations.push(`${path} contains a service locator`)
        }
        if (/\b(?:setupServices|IRuntimeServices|lifecycleServices)\b/.test(source)) {
          violations.push(`${path} contains the retired manual application graph`)
        }
        if (/\bportal\b/.test(source) && /(?:^|\/)core\//.test(path)) {
          violations.push(`${path} retains portal-era core wiring`)
        }
        if (/export\s+async\s+(?:function|const)\s+(?:fx|tx)[A-Z_]/.test(source)) {
          violations.push(`${path} exports an eager fx/tx program`)
        }
        if (
          /\bEffect\.run(?:Promise|Fork|Sync)\s*\(/.test(source)
          && !/(?:\/shell\/(?:runtime|cli)\/|\/main\.ts$|\/index\.tsx$)/.test(path)
        ) {
          violations.push(`${path} executes Effect outside an application runtime edge`)
        }
      }
      if (managedRuntimeCount !== 1) {
        violations.push(`${application} owns ${managedRuntimeCount} production ManagedRuntime instances instead of one`)
      }
    }
    expect(violations).toEqual([])
  })

  test('keeps expected backend semantic failures schema-backed and explicitly mapped', async () => {
    const featureFailures = [
      'apps/backend/src/core/agent/service.agent.ts',
      'apps/backend/src/core/canvas/errors.ts',
      'apps/backend/src/core/database/service.database.ts',
      'apps/backend/src/core/events/service.events.ts',
      'apps/backend/src/core/functions/service.functions.ts',
      'apps/backend/src/core/resources/ResourceError.ts',
      'apps/backend/src/core/resources/service.resources.ts',
      'apps/backend/src/core/widgets/service.widgets.ts',
    ]
    for (const relativePath of featureFailures) {
      const source = await readFile(join(ROOT, relativePath), 'utf8')
      expect(source, `${relativePath} does not own a schema-tagged failure`).toContain('Schema.TaggedError')
      expect(source, `${relativePath} does not bound its failure codes`).toContain('Schema.Literals')
      expect(source, `${relativePath} accepts an arbitrary failure code`).not.toContain('readonly code: string')
    }

    const coreSources = await Promise.all(
      (await sourceFiles(join(ROOT, 'apps/backend/src/core')))
        .filter((file) => !isTestSource(file))
        .map((file) => readFile(file, 'utf8')),
    )
    expect(coreSources.join('\n')).not.toMatch(/class\s+\w*Error\s+extends\s+Error\b/)

    const mapper = await readFile(
      join(ROOT, 'apps/backend/src/shell/transport/semantic-failure.ts'),
      'utf8',
    )
    expect(mapper).toContain('Readonly<Record<TResourceErrorCode, number>>')
    expect(mapper).toContain('semanticFailureLogFields')
    expect(mapper).toContain('semanticFailureToPrivateRpcError')
    expect(mapper).not.toMatch(/error\.code\.(?:includes|startsWith|endsWith)\s*\(/)

    const registryErrorPolicy = await readFile(
      join(ROOT, 'apps/backend/src/shell/transport/private-rpc-error.ts'),
      'utf8',
    )
    expect(registryErrorPolicy).toContain('isSemanticFailure(error)')
    expect(registryErrorPolicy).toContain('semanticFailureStatus(error)')
    expect(registryErrorPolicy).not.toMatch(/error\.code\.(?:includes|startsWith|endsWith)\s*\(/)
  })

  test('runs substantive live and simulated conformance for every application domain', async () => {
    const required = Object.freeze({
      'apps/backend': [
        'canvas',
        'agent',
        'resources',
        'functions',
        'widgets',
        'events',
      ],
      'apps/frontend': [
        'rpc',
        'startup',
        'reconnect',
        'widget-placement',
        'chat',
        'resources',
      ],
    } satisfies Record<string, readonly string[]>)
    const failures: string[] = []
    for (const [application, domains] of Object.entries(required)) {
      const root = join(ROOT, application, 'src/conformance')
      const files = (await listFiles(root)).map((file) => normalized(relative(root, file)))
      for (const domain of domains) {
        const suite = files.some((file) => file === `${domain}.suite.ts`)
        const live = files.some((file) => file === `${domain}.live.test.ts`)
        const sim = files.some((file) => file === `${domain}.sim.test.ts`)
        if (!suite || !live || !sim) {
          failures.push(`${application} ${domain} conformance is incomplete (suite=${suite}, live=${live}, sim=${sim})`)
        }
      }
      const productionSimFiles = (await sourceFiles(join(ROOT, application, 'src/sim')))
        .filter((file) => !isTestSource(file))
      if (productionSimFiles.length === 0) failures.push(`${application} has no simulated service implementations`)
    }
    expect(failures).toEqual([])
  })

  test('keeps remaining application and public-package lifecycles Effect-owned', async () => {
    const frontendLifecycleFiles = [
      'apps/frontend/src/shell/framework/feature/sidebar/widgets/WidgetCatalogProvider.tsx',
      'apps/frontend/src/shell/framework/feature/resource/GenericResourcePage.tsx',
      'apps/frontend/src/shell/framework/feature/db-resource/DbResourcePage.tsx',
      'apps/frontend/src/shell/canvas/canvas-host-retirement.ts',
      'apps/frontend/src/shell/browser/notifications.ts',
    ]
    for (const relativePath of frontendLifecycleFiles) {
      const source = await readFile(join(ROOT, relativePath), 'utf8')
      expect(source, `${relativePath} retains a host timer`).not.toMatch(/\b(?:setTimeout|setInterval)\s*\(/)
      expect(source, `${relativePath} retains a manual async iterator loop`).not.toMatch(/\bfor\s+await\s*\(/)
    }

    const schedulerQualification = await readFile(
      join(ROOT, 'apps/backend/src/sim/scheduler-qualification.test.ts'),
      'utf8',
    )
    for (const evidence of [
      'orders priorities',
      'Effect.yieldNow',
      'Effect.callback',
      'TestClock.adjust',
      'Fiber.interrupt',
      'runtime disposal',
    ]) {
      expect(schedulerQualification, `scheduler qualification misses ${evidence}`).toContain(evidence)
    }

    for (const [directory, expectedRuntimeOwner] of [
      ['packages/canvas', 'src/internal/CanvasEffectRuntime.ts'],
      ['packages/component-ai-chat', 'src/internal/stream-lifecycle.ts'],
    ] as const) {
      let managedRuntimeCount = 0
      for (const file of await sourceFiles(join(ROOT, directory, 'src'))) {
        managedRuntimeCount += [...(await readFile(file, 'utf8')).matchAll(/\bManagedRuntime\.make\s*\(/g)].length
      }
      expect(managedRuntimeCount, `${directory} must own one instance runtime constructor`).toBe(1)
      const owner = await readFile(join(ROOT, directory, expectedRuntimeOwner), 'utf8')
      expect(owner).toContain('ManagedRuntime.make')
    }

    const canvasDocument = await readFile(
      join(ROOT, 'packages/canvas/src/services/CanvasDocumentService.ts'),
      'utf8',
    )
    expect(canvasDocument).toContain('#reloadEffect(')
    expect(canvasDocument).toContain('CanvasSyncSupervisor')
    expect(canvasDocument).not.toContain('#consumeEventsEffect(')
    expect(canvasDocument).not.toMatch(/async\s+#reloadUntilRecovered\s*\(/)

    const canvasSyncSupervisor = await readFile(
      join(ROOT, 'packages/canvas/src/services/CanvasSyncSupervisor.ts'),
      'utf8',
    )
    expect(canvasSyncSupervisor).toContain('#consumeEventsEffect(')
    expect(canvasSyncSupervisor).toContain('waitBeforeRetryEffect(')
    expect(canvasSyncSupervisor).not.toMatch(/async\s+#consumeEventsEffect\s*\(/)

    const chatLifecycle = await readFile(
      join(ROOT, 'packages/component-ai-chat/src/internal/stream-lifecycle.ts'),
      'utf8',
    )
    expect(chatLifecycle).toContain('fxPollAiChat')
    expect(chatLifecycle).toContain('Stream.fromAsyncIterable')
    expect(chatLifecycle).not.toMatch(/\bsetInterval\s*\(/)
  })

  test('keeps collaborative widget state deleted from runtime and persistence surfaces', async () => {
    const productionFiles = [
      ...(await sourceFiles(join(ROOT, 'apps/backend/src'))),
      ...(await sourceFiles(join(ROOT, 'apps/frontend/src'))),
      ...(await sourceFiles(join(ROOT, 'packages/sdk/src'))),
    ].filter((file) => !isTestSource(file))
    const production = (await Promise.all(
      productionFiles.map((file) => readFile(file, 'utf8')),
    )).join('\n')
    for (const retired of [
      'omnidraw.widget.collaborative_state',
      'widget.runtime.state.get',
      'widget.runtime.state.change',
      'widget.runtime.state.events',
      'widget_instance_states',
      'createCollaborativeStateClient',
      'IWidgetStateHostPort',
    ]) expect(production).not.toContain(retired)

    const sdkManifest = await readJson(join(ROOT, 'packages/sdk/package.json'))
    expect(sdkManifest.exports).not.toHaveProperty('./state')
    const baseline = await readFile(
      join(ROOT, 'apps/backend/src/shell/database/migrations/000-initial.sql'),
      'utf8',
    )
    expect(baseline).not.toContain('widget_instance_states')
  })
})

describe('isolated consumer and tooling gates', () => {
  test('fixtures pin only the qualified public set and have no repository aliases', async () => {
    const packageSet = await readPublicPackageSet(ROOT)
    const externalRoot = join(ROOT, 'tests/fixtures/external-composition')
    const external = await readJson(join(externalRoot, 'package.json'))
    expect(external.dependencies).toEqual({
      ...packageSet.packages,
      '@solidjs/signals': EXACT_QUALIFICATION_VERSIONS['@solidjs/signals'],
      '@solidjs/web': EXACT_QUALIFICATION_VERSIONS['@solidjs/web'],
      'solid-js': EXACT_QUALIFICATION_VERSIONS['solid-js'],
    })
    const canvas = await readJson(join(ROOT, 'tests/fixtures/canvas-consumer/package.json'))
    expect(canvas.dependencies).toMatchObject({
      '@omnidraw/canvas-contract': packageSet.packages['@omnidraw/canvas-contract'],
      '@omnidraw/canvas': packageSet.packages['@omnidraw/canvas'],
      '@omnidraw/component-ai-chat': packageSet.packages['@omnidraw/component-ai-chat'],
      '@omnidraw/theme': packageSet.packages['@omnidraw/theme'],
      '@solidjs/signals': EXACT_QUALIFICATION_VERSIONS['@solidjs/signals'],
      '@solidjs/web': EXACT_QUALIFICATION_VERSIONS['@solidjs/web'],
      'solid-js': EXACT_QUALIFICATION_VERSIONS['solid-js'],
    })
    for (const root of [externalRoot, join(ROOT, 'tests/fixtures/canvas-consumer')]) {
      const tsconfig = await readJson(join(root, 'tsconfig.json'))
      expect(tsconfig.extends).toBeUndefined()
      expect((tsconfig.compilerOptions as Record<string, unknown> | undefined)?.paths).toBeUndefined()
      const text = (await Promise.all((await listFiles(root)).map((file) => readFile(file, 'utf8')))).join('\n')
      expect(text).not.toMatch(/(?:workspace|catalog|link|file):/)
      expect(text).not.toContain('../../packages')
    }
  })

  test('release and packed-composition tools are driven by the five-package set', async () => {
    for (const script of [
      'prepare-package-dist.ts',
      'verify-package-dists.ts',
      'list-package-deployments.ts',
    ]) {
      const source = await readFile(join(ROOT, 'scripts', script), 'utf8')
      expect(source, script).toContain("from './public-packages'")
    }
    const packed = await readFile(join(ROOT, 'scripts/test-packed-public-composition.ts'), 'utf8')
    for (const name of PUBLIC_PACKAGE_NAMES) expect(packed).toContain(name)
    expect(packed).toContain("'tests', 'fixtures', 'external-composition'")
    const browser = await readFile(join(ROOT, 'scripts/test-packed-canvas.ts'), 'utf8')
    expect(browser).toContain("tests/fixtures/canvas-consumer")
  })
})
