import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'

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

type TRemovedStackPattern = Readonly<{
  label: string
  expression: RegExp
}>

function removedStackPattern(
  label: string,
  parts: readonly string[],
  options?: Readonly<{ word?: boolean; insensitive?: boolean }>,
): TRemovedStackPattern {
  const token = parts.join('')
  return {
    label,
    expression: new RegExp(
      options?.word ? `\\b${token}\\b` : token,
      options?.insensitive ? 'i' : undefined,
    ),
  }
}

const REMOVED_STACK_PATTERNS = Object.freeze([
  removedStackPattern('legacy-library-name', ['auto', 'merge'], { insensitive: true }),
  removedStackPattern('legacy-dependency-scope', ['@auto', 'merge/'], { insensitive: true }),
  removedStackPattern('legacy-service-package', ['service-', 'auto', 'merge'], { insensitive: true }),
  removedStackPattern('legacy-server-service', ['Auto', 'merge', 'Service'], { word: true }),
  removedStackPattern('legacy-document-handle', ['Doc', 'Handle'], { word: true }),
  removedStackPattern('legacy-client-service', ['Crdt', 'Service'], { word: true }),
  removedStackPattern('legacy-websocket-route', ['/auto', 'merge'], { insensitive: true }),
  removedStackPattern('legacy-url-column', ['auto', 'merge', '_url'], { word: true, insensitive: true }),
  removedStackPattern('legacy-document-table', ['collaboration_', 'documents'], { word: true, insensitive: true }),
  removedStackPattern('legacy-chunk-table', ['collaboration_', 'chunks'], { word: true, insensitive: true }),
  removedStackPattern('legacy-document-type', ['TCanvas', 'Doc'], { word: true }),
  removedStackPattern('legacy-element-type', ['T', 'Element'], { word: true }),
  removedStackPattern('legacy-group-type', ['T', 'Group'], { word: true }),
  removedStackPattern('legacy-document-projection', ['TCanvasDocument', 'Projection'], { word: true }),
  removedStackPattern('legacy-element-projector', ['TCanvasElement', 'Projector'], { word: true }),
  removedStackPattern('legacy-projection-coordinator', ['Projection', 'Coordinator'], { word: true }),
  removedStackPattern('legacy-client-projection', ['CrdtProjection', 'Service'], { word: true }),
  removedStackPattern('legacy-widget-projector', ['WidgetInstanceMetadata', 'Projector'], { word: true }),
  removedStackPattern('legacy-widget-projection-store', ['WidgetInstanceMetadata', 'StoreTurso'], { word: true }),
  removedStackPattern('legacy-widget-projection-helper', ['fn.widget-instance-', 'metadata-projection'], {
    insensitive: true,
  }),
  removedStackPattern('legacy-projection-heads', ['widget_instance_', 'projection_heads'], {
    word: true,
    insensitive: true,
  }),
  removedStackPattern('legacy-widget-state-document-column', ['state_', 'document_id'], {
    word: true,
    insensitive: true,
  }),
  removedStackPattern('legacy-projection-signature-column', ['projection_', 'signature'], {
    word: true,
    insensitive: true,
  }),
  removedStackPattern('legacy-document-signature', ['fnCanvasDocumentProjection', 'Signature'], { word: true }),
  removedStackPattern('legacy-document-diff', ['fnDiffCanvas', 'Projections'], { word: true }),
  removedStackPattern('legacy-projector-directory', ['/projection/', 'projectors/'], { insensitive: true }),
  removedStackPattern('legacy-document-types-module', ['canvas-doc.', 'types'], { insensitive: true }),
  removedStackPattern('legacy-document-schema-module', ['canvas-doc.', 'zod'], { insensitive: true }),
  removedStackPattern('legacy-project-document-module', ['fn.project-', 'document'], { insensitive: true }),
  removedStackPattern('legacy-incremental-document-module', ['fn.incremental-', 'document'], { insensitive: true }),
  removedStackPattern('legacy-document-signature-module', ['fn.document-', 'signature'], { insensitive: true }),
  removedStackPattern('legacy-compatibility-fixture', ['canvas-engine/', 'compatibility'], { insensitive: true }),
  removedStackPattern('legacy-engine-adapter', ['CanvasEngine', 'Adapter'], { word: true }),
  removedStackPattern('legacy-editor-bridge', ['CanvasEditor', 'Bridge'], { word: true }),
  removedStackPattern('legacy-projection-port', ['ProjectionRuntime', 'Port'], { word: true }),
] satisfies readonly TRemovedStackPattern[])

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

async function removedStackScanFiles(): Promise<string[]> {
  const nested = (await Promise.all(
    ['apps', 'packages', 'scripts'].map((directory) => listFiles(join(ROOT, directory))),
  )).flat()
  return [
    join(ROOT, 'package.json'),
    join(ROOT, 'bun.lock'),
    ...nested.filter((path) => (
      SOURCE_EXTENSIONS.has(extname(path))
      || extname(path) === '.sql'
      || extname(path) === '.json'
    )),
  ].sort()
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

  test('keeps the removed canvas stack absent from source, schema, manifests, and lockfile', async () => {
    const violations: string[] = []
    for (const file of await removedStackScanFiles()) {
      const path = relative(ROOT, file)
      const searchable = `${path}\n${await readFile(file, 'utf8')}`
      for (const pattern of REMOVED_STACK_PATTERNS) {
        if (pattern.expression.test(searchable)) {
          violations.push(`${path}: ${pattern.label}`)
        }
      }
    }
    expect(violations).toEqual([])
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
    expect(fixtureText).not.toMatch(/(?:^|["'\s])workspace:/m)
    expect(fixtureText).not.toMatch(/(?:^|["'\s])file:/m)
    expect(fixtureText).not.toMatch(/(?:^|["'\s])link:/m)
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

})
