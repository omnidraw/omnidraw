import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'

// typescript-eslint only supports the TypeScript 6 API while the workspace
// toolchain is TypeScript 7. Resolve the parser through the private
// scripts/eslint-tooling workspace so its `typescript` peer resolves to 6.x.
const requireTooling = createRequire(resolve(import.meta.dir, 'eslint-tooling/package.json'))
const { parse } = requireTooling('@typescript-eslint/parser') as {
  parse(source: string, options: Record<string, unknown>): unknown
}

const ROOT = resolve(import.meta.dir, '..')
const FIXTURE_ROOT = join(ROOT, 'scripts/fixtures/external-composition')
const CANVAS_KERNEL_FIXTURE_ROOT = join(ROOT, 'scripts/fixtures/canvas-kernel-consumer')
const PUBLIC_PACKAGES = Object.freeze({
  '@omnidraw/function-runtime': 'packages/function-runtime',
  '@omnidraw/resource-runtime': 'packages/resource-runtime',
  '@omnidraw/runtime': 'packages/runtime',
  '@omnidraw/tenant-core': 'packages/tenant-core',
  '@omnidraw/widget-contract': 'packages/widget-contract',
})
const CANVAS_KERNEL_PACKAGES = Object.freeze({
  '@omnidraw/theme-contract': 'packages/theme-contract',
  '@omnidraw/canvas-contract': 'packages/canvas-contract',
  '@omnidraw/service-theme': 'packages/service-theme',
  '@omnidraw/canvas': 'packages/canvas',
})
const CANVAS_KERNEL_ALLOWED_IMPORTS = Object.freeze({
  '@omnidraw/theme-contract': new Set<string>(),
  '@omnidraw/canvas-contract': new Set([
    '@omnidraw/cangine',
    '@omnidraw/theme-contract',
  ]),
  '@omnidraw/service-theme': new Set(['@omnidraw/theme-contract']),
  '@omnidraw/canvas': new Set([
    '@omnidraw/cangine',
    '@omnidraw/canvas-contract',
    '@omnidraw/service-theme',
    '@omnidraw/theme-contract',
  ]),
})
const NPM_PUBLISHABLE_PACKAGE_DIRECTORIES = Object.freeze([
  ...Object.values(PUBLIC_PACKAGES),
  ...Object.values(CANVAS_KERNEL_PACKAGES),
  'packages/sdk',
])
const UI_PACKAGES = Object.freeze({
  '@omnidraw/ui-ai-chat': {
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
  if (!specifier.startsWith('@omnidraw/')) return null
  return specifier.split('/').slice(0, 2).join('/')
}

function exportedTargets(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(exportedTargets)
  if (value === null || typeof value !== 'object') return []
  return Object.values(value).flatMap(exportedTargets)
}

function splitCssSelectorList(value: string): readonly string[] {
  const selectors: string[] = []
  let current = ''
  let parentheses = 0
  let brackets = 0
  let quote: "'" | '"' | null = null
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    if (quote !== null) {
      current += character
      if (character === '\\') {
        current += value[++index] ?? ''
      } else if (character === quote) {
        quote = null
      }
      continue
    }
    if (character === "'" || character === '"') quote = character
    else if (character === '(') parentheses += 1
    else if (character === ')') parentheses -= 1
    else if (character === '[') brackets += 1
    else if (character === ']') brackets -= 1
    else if (character === ',' && parentheses === 0 && brackets === 0) {
      selectors.push(current)
      current = ''
      continue
    }
    current += character
  }
  selectors.push(current)
  return selectors
}

function cssGlobalSelectorViolations(source: string): readonly string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const violations: string[] = []
  for (const rule of withoutComments.matchAll(/(?:^|})\s*([^@{}][^{}]*)\{/g)) {
    for (const rawSelector of splitCssSelectorList(rule[1] ?? '')) {
      const selector = rawSelector.trim()
      if (
        /^(?::root\b|html\b|body\b|\.dark(?:\b|[\s.#:[>+~])|\*(?:$|[\s.#:[>+~])|(?:button|input|textarea|select|form|h[1-6]|ol|ul|li|img|picture|video)(?:\b|[\s.#:[>+~]))/.test(selector)
      ) violations.push(selector)
    }
  }
  return violations
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

const DURABLE_SCENE_METHODS = new Set([
  'apply',
  'replace',
  'transaction',
])
const JAVASCRIPT_TYPESCRIPT_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
])

type TDurableSceneWrite = Readonly<{
  column: number
  line: number
  method: string
}>

type TAstNode = {
  type: string
  loc?: Readonly<{
    start: Readonly<{
      column: number
      line: number
    }>
  }>
  [key: string]: unknown
}

function isAstNode(value: unknown): value is TAstNode {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as { type?: unknown }).type === 'string'
  )
}

function childAstNodes(node: TAstNode): readonly TAstNode[] {
  const children: TAstNode[] = []
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'range' || key === 'tokens' || key === 'comments') {
      continue
    }
    if (isAstNode(value)) {
      children.push(value)
      continue
    }
    if (!Array.isArray(value)) continue
    for (const item of value) {
      if (isAstNode(item)) children.push(item)
    }
  }
  return children
}

function identifierName(node: TAstNode): string | null {
  return node.type === 'Identifier' && typeof node.name === 'string'
    ? node.name
    : null
}

function unwrapExpression(expression: TAstNode): TAstNode {
  let current = expression
  const wrappers = new Set([
    'ChainExpression',
    'TSAsExpression',
    'TSInstantiationExpression',
    'TSNonNullExpression',
    'TSSatisfiesExpression',
    'TSTypeAssertion',
  ])
  while (wrappers.has(current.type) && isAstNode(current.expression)) {
    current = current.expression
  }
  return current
}

function staticMember(
  expression: TAstNode,
): Readonly<{ name: string | null; receiver: TAstNode }> | null {
  const current = unwrapExpression(expression)
  if (
    current.type !== 'MemberExpression'
    || !isAstNode(current.object)
    || !isAstNode(current.property)
  ) return null
  const computed = current.computed === true
  const property = unwrapExpression(current.property)
  const name = computed
    ? property.type === 'Literal' && typeof property.value === 'string'
      ? property.value
      : property.type === 'TemplateLiteral'
        && Array.isArray(property.expressions)
        && property.expressions.length === 0
        && Array.isArray(property.quasis)
        && isAstNode(property.quasis[0])
        && isAstNode(property.quasis[0].value)
        && typeof property.quasis[0].value.cooked === 'string'
        ? property.quasis[0].value.cooked
        : null
    : identifierName(property)
  return {
    name,
    receiver: current.object,
  }
}

function bindingNames(
  pattern: TAstNode,
): readonly Readonly<{ name: string; property: string }>[] {
  if (pattern.type !== 'ObjectPattern' || !Array.isArray(pattern.properties)) {
    return []
  }
  const result: Array<Readonly<{ name: string; property: string }>> = []
  for (const candidate of pattern.properties) {
    if (
      !isAstNode(candidate)
      || candidate.type !== 'Property'
      || !isAstNode(candidate.key)
      || !isAstNode(candidate.value)
    ) continue
    const name = identifierName(candidate.value)
    const property = identifierName(candidate.key)
      ?? (
        candidate.key.type === 'Literal'
        && typeof candidate.key.value === 'string'
        ? candidate.key.value
        : null
      )
    if (name !== null && property !== null) result.push({ name, property })
  }
  return result
}

function durableSceneWrites(
  path: string,
  source: string,
): readonly TDurableSceneWrite[] {
  const sourceFile = parse(source, {
    comment: false,
    jsx: path.endsWith('.tsx') || path.endsWith('.jsx'),
    loc: true,
    range: false,
    sourceType: 'module',
    tokens: false,
  }) as unknown as TAstNode
  const sceneAliases = new Set(['scene'])
  const methodAliases = new Map<string, string>()
  const isSceneExpression = (expression: TAstNode): boolean => {
    const current = unwrapExpression(expression)
    const name = identifierName(current)
    if (name !== null) return sceneAliases.has(name)
    return staticMember(current)?.name === 'scene'
  }
  const rememberMethodAlias = (
    name: string,
    expression: TAstNode,
  ): boolean => {
    const current = unwrapExpression(expression)
    const identifier = identifierName(current)
    if (identifier !== null) {
      const method = methodAliases.get(identifier)
      if (method === undefined || methodAliases.get(name) === method) return false
      methodAliases.set(name, method)
      return true
    }
    const member = staticMember(current)
    if (
      member === null
      || member.name === null
      || !DURABLE_SCENE_METHODS.has(member.name)
      || !isSceneExpression(member.receiver)
      || methodAliases.get(name) === member.name
    ) return false
    methodAliases.set(name, member.name)
    return true
  }
  const rememberAliases = (node: TAstNode): boolean => {
    let changed = false
    if (
      node.type === 'VariableDeclarator'
      && isAstNode(node.id)
      && isAstNode(node.init)
    ) {
      const name = identifierName(node.id)
      if (name !== null) {
        if (isSceneExpression(node.init) && !sceneAliases.has(name)) {
          sceneAliases.add(name)
          changed = true
        }
        if (rememberMethodAlias(name, node.init)) changed = true
      } else {
        const initializerIsScene = isSceneExpression(node.init)
        for (const binding of bindingNames(node.id)) {
          if (binding.property === 'scene' && !sceneAliases.has(binding.name)) {
            sceneAliases.add(binding.name)
            changed = true
          }
          if (
            initializerIsScene
            && DURABLE_SCENE_METHODS.has(binding.property)
            && methodAliases.get(binding.name) !== binding.property
          ) {
            methodAliases.set(binding.name, binding.property)
            changed = true
          }
        }
      }
    }
    if (
      node.type === 'AssignmentExpression'
      && node.operator === '='
      && isAstNode(node.left)
      && isAstNode(node.right)
    ) {
      const name = identifierName(unwrapExpression(node.left))
      if (name !== null) {
        if (isSceneExpression(node.right) && !sceneAliases.has(name)) {
          sceneAliases.add(name)
          changed = true
        }
        if (rememberMethodAlias(name, node.right)) changed = true
      }
    }
    for (const child of childAstNodes(node)) {
      if (rememberAliases(child)) changed = true
    }
    return changed
  }
  while (rememberAliases(sourceFile)) {
    // Resolve alias chains independent of declaration order.
  }

  const writes: TDurableSceneWrite[] = []
  const visit = (node: TAstNode): void => {
    if (node.type === 'CallExpression' && isAstNode(node.callee)) {
      const target = unwrapExpression(node.callee)
      const identifier = identifierName(target)
      let method = identifier !== null
        ? (methodAliases.get(identifier) ?? null)
        : null
      if (method === null) {
        const member = staticMember(target)
        if (member !== null && isSceneExpression(member.receiver)) {
          method = member.name === null
            ? '<computed>'
            : DURABLE_SCENE_METHODS.has(member.name)
            ? member.name
            : null
        }
      }
      if (method !== null) {
        writes.push({
          method,
          line: node.loc?.start.line ?? 0,
          column: (node.loc?.start.column ?? -1) + 1,
        })
      }
    }
    for (const child of childAstNodes(node)) visit(child)
  }
  visit(sourceFile)
  return writes
}

describe('managed composition architecture boundaries', () => {
  test('keeps the consolidated API as the only API package and import namespace', async () => {
    const manifests = await packageManifests()
    const oldApiFiles = (await listFiles(join(ROOT, 'packages')))
      .map((path) => relative(join(ROOT, 'packages'), path))
      .filter((path) => path.split(sep)[0]?.startsWith('api-'))
    expect(oldApiFiles).toEqual([])

    const apiPackages = manifests
      .filter(({ manifest }) => manifest.name === '@omnidraw/api' || manifest.name?.startsWith('@omnidraw/api-'))
      .map(({ manifest }) => manifest.name)
      .sort()
    expect(apiPackages).toEqual(['@omnidraw/api'])
    expect(
      manifests.find(({ manifest }) => manifest.name === '@omnidraw/api')?.path,
    ).toBe(join(ROOT, 'packages/api/package.json'))
    expect(manifests.flatMap(({ path, manifest }) => (
      manifestDependencies(manifest)
        .filter((dependency) => dependency.startsWith('@omnidraw/api-'))
        .map((dependency) => `${relative(ROOT, path)} depends on ${dependency}`)
    ))).toEqual([])

    const violations: string[] = []
    for (const root of ['apps', 'packages', 'scripts']) {
      for (const file of await sourceFiles(join(ROOT, root))) {
        const source = await readFile(file, 'utf8')
        for (const specifier of moduleSpecifiers(source)) {
          if (specifier.startsWith('@omnidraw/api-')) {
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
    expect(packageNames.has('@omnidraw/ai-chat')).toBe(false)
    expect(packageNames.has('@omnidraw/actor-ui')).toBe(false)
    expect(manifests.flatMap(({ path, manifest }) => (
      manifestDependencies(manifest)
        .filter((dependency) => dependency === '@omnidraw/ai-chat' || dependency === '@omnidraw/actor-ui')
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
          if (specifier === '@omnidraw/ai-chat' || specifier.startsWith('@omnidraw/ai-chat/')) {
            oldUiImports.push(`${relative(ROOT, file)} imports ${specifier}`)
          }
          if (specifier === '@omnidraw/actor-ui' || specifier.startsWith('@omnidraw/actor-ui/')) {
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
    for (const dependency of ['@omnidraw/runtime', 'sqlite', 'turso', '@libsql/client']) {
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

  test('keeps the canvas kernel versioned, public, built, and deliberately exported', async () => {
    const releaseVersions = new Map<string, string>([
      ['@omnidraw/cangine', '0.6.1'],
      ['@omnidraw/theme-contract', '0.5.0'],
      ['@omnidraw/canvas-contract', '0.5.0'],
      ['@omnidraw/service-theme', '0.5.0'],
      ['@omnidraw/canvas', '0.5.1'],
    ])

    for (const [name, directory] of Object.entries(CANVAS_KERNEL_PACKAGES)) {
      const manifest = JSON.parse(
        await readFile(join(ROOT, directory, 'package.json'), 'utf8'),
      ) as {
        name?: string
        version?: string
        private?: boolean
        license?: string
        repository?: { directory?: string; type?: string; url?: string }
        files?: readonly string[]
        exports?: Record<string, unknown>
        scripts?: Record<string, string>
        dependencies?: Record<string, string>
        optionalDependencies?: Record<string, string>
        peerDependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const stagedManifest = JSON.parse(
        await readFile(join(ROOT, directory, 'dist/package.json'), 'utf8'),
      ) as typeof manifest
      expect(manifest.name).toBe(name)
      expect(manifest.version).toBe(releaseVersions.get(name))
      expect(manifest.private).not.toBe(true)
      expect(manifest.license).toBe('MIT')
      expect(manifest.repository?.type).toBe('git')
      expect(manifest.repository?.url).toContain('vibecanvas')
      expect(manifest.repository?.directory).toBe(directory)
      expect(manifest.files).toContain('dist')
      expect(manifest.files).toContain('README.md')
      expect(manifest.exports?.['.']).toBeDefined()
      expect(Object.keys(manifest.exports ?? {}).some((key) => key.includes('*'))).toBe(false)
      if (name === '@omnidraw/canvas') {
        expect(manifest.exports?.['./styles.css']).toBeDefined()
        expect(manifest.exports?.['./CONSTANTS']).toBeUndefined()
        expect(manifest.exports?.['./fn.browser-tenant-scope']).toBeUndefined()
      }
      for (const [exportKey, exportValue] of Object.entries(manifest.exports ?? {})) {
        const targets = exportedTargets(exportValue)
        expect(targets.length, `${name} ${exportKey} has no export target`).toBeGreaterThan(0)
        for (const target of targets) {
          expect(
            target.startsWith('./dist/'),
            `${name} ${exportKey} exports workspace source`,
          ).toBe(true)
          expect(target, `${name} ${exportKey} exports workspace source`).not.toContain('/src/')
          expect(target.slice(2), `${name} ${exportKey} exports a repository path`).not.toContain('..')
        }
        if (exportKey.endsWith('.css')) {
          expect(targets.every((target) => target.endsWith('.css'))).toBe(true)
          continue
        }
        expect(exportValue !== null && typeof exportValue === 'object').toBe(true)
        const conditional = exportValue as { types?: unknown; default?: unknown }
        expect(typeof conditional.types, `${name} ${exportKey} has no declaration export`).toBe('string')
        expect(typeof conditional.default, `${name} ${exportKey} has no ESM export`).toBe('string')
        expect((conditional.types as string).endsWith('.d.ts')).toBe(true)
        expect((conditional.default as string).endsWith('.js')).toBe(true)
      }
      expect(manifest.scripts?.build).toBeDefined()
      expect(manifest.scripts?.typecheck).toBeDefined()
      expect(manifest.scripts?.test).toBeDefined()
      expect(manifest.scripts?.prepublishOnly).toContain('build')
      expect(manifest.scripts?.prepublishOnly).toContain('typecheck')
      expect(manifest.scripts?.prepublishOnly).toContain('test')
      expect(JSON.stringify(stagedManifest)).not.toMatch(/(?:workspace|catalog|file|link):/)

      const allowedImports = CANVAS_KERNEL_ALLOWED_IMPORTS[name as keyof typeof CANVAS_KERNEL_ALLOWED_IMPORTS]
      for (const group of [
        manifest.dependencies,
        manifest.optionalDependencies,
        manifest.peerDependencies,
        manifest.devDependencies,
      ]) {
        for (const dependency of Object.keys(group ?? {})) {
          if (!dependency.startsWith('@omnidraw/')) continue
          expect(
            allowedImports.has(dependency),
            `${name} declares private Omnidraw dependency ${dependency}`,
          ).toBe(true)
        }
      }
      for (const group of [
        stagedManifest.dependencies,
        stagedManifest.optionalDependencies,
        stagedManifest.peerDependencies,
        stagedManifest.devDependencies,
      ]) {
        for (const [dependency, version] of Object.entries(group ?? {})) {
          if (!dependency.startsWith('@omnidraw/')) continue
          expect(
            allowedImports.has(dependency),
            `${name} stages private Omnidraw dependency ${dependency}`,
          ).toBe(true)
          expect(releaseVersions.has(dependency)).toBe(true)
          expect(version, `${name} must pin ${dependency} exactly`).toBe(releaseVersions.get(dependency)!)
        }
      }

      if (name === '@omnidraw/canvas') {
        expect(manifest.dependencies?.['solid-js']).toBeUndefined()
        expect(manifest.optionalDependencies?.['solid-js']).toBeUndefined()
        expect(manifest.peerDependencies?.['solid-js']).toBeDefined()
        expect(manifest.devDependencies?.['solid-js']).toBe(manifest.peerDependencies?.['solid-js'])
      }
    }
  })

  test('keeps canvas-kernel source imports on the public dependency graph', async () => {
    for (const [name, directory] of Object.entries(CANVAS_KERNEL_PACKAGES)) {
      const packageRoot = join(ROOT, directory)
      const allowedImports = CANVAS_KERNEL_ALLOWED_IMPORTS[name as keyof typeof CANVAS_KERNEL_ALLOWED_IMPORTS]
      const violations: string[] = []
      for (const file of await sourceFiles(join(packageRoot, 'src'))) {
        const source = await readFile(file, 'utf8')
        for (const specifier of moduleSpecifiers(source)) {
          if (specifier.startsWith('.')) {
            const target = resolve(dirname(file), specifier)
            if (relative(packageRoot, target).startsWith('..')) {
              violations.push(`${relative(ROOT, file)} imports sibling source ${specifier}`)
            }
            continue
          }
          const packageName = publicPackageName(specifier)
          if (packageName !== null && !allowedImports.has(packageName)) {
            violations.push(`${relative(ROOT, file)} imports private package ${specifier}`)
          }
          if (/@omnidraw\/[^/'"]+\/src(?:\/|$)/.test(specifier)) {
            violations.push(`${relative(ROOT, file)} deep-imports package source ${specifier}`)
          }
          if (isForbiddenManagedDependency(specifier)) {
            violations.push(`${relative(ROOT, file)} imports managed implementation ${specifier}`)
          }
        }
      }
      expect(violations).toEqual([])
    }
  })

  test('keeps canvas-kernel output ready for every frontend build and development path', async () => {
    const rootManifest = JSON.parse(
      await readFile(join(ROOT, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> }
    expect(rootManifest.scripts?.prebuild).toContain('build:canvas-kernel')
    expect(rootManifest.scripts?.build).toBe("bun run build:canvas-kernel && bun run --filter '*' build")
    expect(rootManifest.scripts?.['prebuild:single']).toBeUndefined()
    expect(rootManifest.scripts?.predev).toContain('build:canvas-kernel')
    expect(rootManifest.scripts?.predev).toContain('publish-widget-packages')
    expect(rootManifest.scripts?.['server:dev']).toContain('publish-widget-packages')
    expect(rootManifest.scripts?.['registry:publish:widgets']).toContain('publish-widget-packages')
    expect(rootManifest.scripts?.['preclient:dev']).toContain('build:canvas-kernel')
    expect(rootManifest.scripts?.['client:dev']).toContain('scripts/dev-frontend.ts')

    const mainDevSource = await readFile(join(ROOT, 'scripts/dev.ts'), 'utf8')
    expect(mainDevSource).toContain('scripts/dev-frontend.ts')

    const frontendDevSource = await readFile(
      join(ROOT, 'scripts/dev-frontend.ts'),
      'utf8',
    )
    expect(frontendDevSource).toContain('packages/theme-contract')
    expect(frontendDevSource).toContain('packages/canvas-contract')
    expect(frontendDevSource).toContain('packages/service-theme')
    expect(frontendDevSource).toContain('packages/canvas')

    const themeContractManifest = JSON.parse(
      await readFile(join(ROOT, 'packages/theme-contract/package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> }
    const contractManifest = JSON.parse(
      await readFile(join(ROOT, 'packages/canvas-contract/package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> }
    const themeManifest = JSON.parse(
      await readFile(join(ROOT, 'packages/service-theme/package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> }
    const canvasManifest = JSON.parse(
      await readFile(join(ROOT, 'packages/canvas/package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> }
    expect(themeContractManifest.scripts?.dev).toContain('--watch')
    expect(contractManifest.scripts?.dev).toContain('--watch')
    expect(themeManifest.scripts?.dev).toContain('--watch')
    expect(canvasManifest.scripts?.['dev:bundle']).toContain('--watch')
    expect(canvasManifest.scripts?.['dev:types']).toContain('--watch')
  })

  test('keeps canvas styles scoped and package-relative', async () => {
    const canvasRoot = join(ROOT, CANVAS_KERNEL_PACKAGES['@omnidraw/canvas'])
    const sourcePaths = await listFiles(join(canvasRoot, 'src'))
    const violations: string[] = []
    for (const file of sourcePaths) {
      const source = await readFile(file, 'utf8')
      const path = relative(ROOT, file)
      if (/(?:^|[('"\s])\/fonts\//m.test(source)) {
        violations.push(`${path}: root-relative /fonts/ URL`)
      }
      if (extname(file) !== '.css') continue
      for (const selector of cssGlobalSelectorViolations(source)) {
        violations.push(`${path}: global selector ${selector}`)
      }
      for (const match of source.matchAll(/url\(\s*(['"]?)\/[^/]/g)) {
        violations.push(`${path}: root-relative asset URL ${match[0]}`)
      }
    }
    expect(violations).toEqual([])
  })

  test('keeps release dependencies exact while Bun links the same versions for local development', async () => {
    const fixturePackage = JSON.parse(await readFile(join(FIXTURE_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(Object.keys(fixturePackage.dependencies).sort()).toEqual(
      Object.keys(PUBLIC_PACKAGES).sort(),
    )

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
        expect(dependencyVersion, `${name} must link ${dependencyName} through the workspace`).toBe('workspace:*')
      }
    }

    for (const directory of NPM_PUBLISHABLE_PACKAGE_DIRECTORIES) {
      const packageJson = JSON.parse(await readFile(join(ROOT, directory, 'package.json'), 'utf8')) as {
        publishConfig?: { '@omnidraw:registry'?: string; access?: string; registry?: string }
        scripts?: Record<string, string>
      }
      expect(packageJson.publishConfig).toMatchObject({
        '@omnidraw:registry': 'https://registry.npmjs.org/',
        access: 'public',
        registry: 'https://registry.npmjs.org/',
      })
      expect(packageJson.scripts?.prepublishOnly).toBeDefined()
    }

    const rootPackage = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as {
      workspaces: string[]
      catalog: Record<string, string>
    }
    expect(rootPackage.workspaces).toContain('scripts/fixtures/external-composition')
    expect(rootPackage.catalog['@omnidraw/capsule']).toBe('0.12.0')
  })

  test('keeps Capsule private profile names out of production source', async () => {
    const privateProfileNames = [
      'artifact-resources-v1',
      'artifact-resources-v2',
      'artifact-resources-v3',
      'canvas-2d-v1',
      'canvas-webgl-v1',
      'canvas-webgpu-v1',
      'css-network-images-v1',
      'dom-selection-v1',
      'fetch-buffered-v1',
      'shadow-browser-css-v1',
      'svg-dom-v1',
    ]
    const violations: string[] = []
    for (const root of ['apps', 'packages']) {
      for (const file of await sourceFiles(join(ROOT, root))) {
        const path = relative(ROOT, file).split(sep).join('/')
        if (
          path.includes('/tests/')
          || path.startsWith('apps/cli/public/assets/')
          || path.endsWith('.test.ts')
          || path.endsWith('.test.tsx')
        ) continue
        const source = await readFile(file, 'utf8')
        for (const name of privateProfileNames) {
          if (source.includes(name)) violations.push(`${path}: ${name}`)
        }
      }
    }
    expect(violations).toEqual([])

    for (const { path, manifest } of await packageManifests()) {
      const capsuleVersion = [
        manifest.dependencies,
        manifest.devDependencies,
        manifest.optionalDependencies,
        manifest.peerDependencies,
      ].map((group) => group?.['@omnidraw/capsule'])
        .find((version) => version !== undefined)
      if (capsuleVersion === undefined) continue
      expect(
        capsuleVersion,
        `${relative(ROOT, path)} must use the shared Capsule catalog except when published to npm`,
      ).toBe(
        'catalog:',
      )
    }
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
    expect(fixtureText).not.toMatch(/@omnidraw\/[^'"\s]+\/src\//)
    expect(fixtureText).not.toContain('../../packages')
    expect(fixtureText).not.toContain('apps/cli')
    expect(fixtureText).not.toContain('@omnidraw/api')
    expect(fixtureText).not.toContain('@omnidraw/service-')

    const apiFiles = await sourceFiles(join(ROOT, 'packages/api/src'))
    const apiText = (await Promise.all(apiFiles.map((path) => readFile(path, 'utf8')))).join('\n')
    expect(apiText).not.toContain('external-composition')
    expect(apiText).not.toContain('@omnidraw-fixtures/private-managed-composition')
  })

  test('keeps the canvas-kernel browser fixture standalone and on documented exports', async () => {
    const manifest = JSON.parse(
      await readFile(join(CANVAS_KERNEL_FIXTURE_ROOT, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(manifest.dependencies).toEqual({
      '@omnidraw/canvas': '0.5.1',
      '@omnidraw/canvas-contract': '0.5.0',
      '@omnidraw/service-theme': '0.5.0',
      'solid-js': '1.9.14',
    })
    expect(JSON.stringify(manifest)).not.toMatch(/(?:workspace|catalog|file|link):/)

    const rootManifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as {
      workspaces?: readonly string[]
    }
    expect(rootManifest.workspaces).not.toContain('scripts/fixtures/canvas-kernel-consumer')
    const tsconfig = JSON.parse(
      await readFile(join(CANVAS_KERNEL_FIXTURE_ROOT, 'tsconfig.json'), 'utf8'),
    ) as { extends?: unknown; compilerOptions?: { paths?: unknown } }
    expect(tsconfig.extends).toBeUndefined()
    expect(tsconfig.compilerOptions?.paths).toBeUndefined()

    const packageExports = new Map(await Promise.all(
      Object.entries(CANVAS_KERNEL_PACKAGES).map(async ([name, directory]) => {
        const packageManifest = JSON.parse(
          await readFile(join(ROOT, directory, 'package.json'), 'utf8'),
        ) as { exports?: Record<string, unknown> }
        return [name, new Set(Object.keys(packageManifest.exports ?? {}))] as const
      }),
    ))
    const allowedTooling = new Set([
      'playwright',
      'solid-js',
      'vite',
      'vite-plugin-solid',
    ])
    const violations: string[] = []
    const fixtureFiles = await listFiles(CANVAS_KERNEL_FIXTURE_ROOT)
    for (const file of fixtureFiles) {
      const path = relative(ROOT, file)
      if (['.diff', '.patch'].includes(extname(file)) || path.split(sep).includes('patches')) {
        violations.push(`${path}: patch/source escape hatch`)
      }
      const source = await readFile(file, 'utf8')
      if (source.includes('../../packages') || source.includes('@omnidraw/service-db')) {
        violations.push(`${path}: repository/private implementation reference`)
      }
      if (!SOURCE_EXTENSIONS.has(extname(file))) continue
      for (const specifier of moduleSpecifiers(source)) {
        if (/^(?:bun|node):/.test(specifier)) continue
        if (specifier.startsWith('.')) {
          if (specifier.startsWith('..')) violations.push(`${path}: escapes fixture via ${specifier}`)
          continue
        }
        const packageName = publicPackageName(specifier)
        if (packageName === null) {
          const dependency = dependencyPackageName(specifier)
          if (!allowedTooling.has(dependency)) violations.push(`${path}: imports ${specifier}`)
          continue
        }
        if (!Object.hasOwn(CANVAS_KERNEL_PACKAGES, packageName)) {
          violations.push(`${path}: imports non-kernel ${specifier}`)
          continue
        }
        const exportKey = specifier === packageName ? '.' : `.${specifier.slice(packageName.length)}`
        if (!packageExports.get(packageName)?.has(exportKey)) {
          violations.push(`${path}: imports undocumented ${specifier}`)
        }
      }
    }
    expect(violations).toEqual([])

    const mainSource = await readFile(join(CANVAS_KERNEL_FIXTURE_ROOT, 'src/main.tsx'), 'utf8')
    const canvasInvocation = mainSource.match(/<Canvas\s+([\s\S]*?)\/>/)?.[1]
    expect(canvasInvocation).toBeDefined()
    expect(canvasInvocation).not.toMatch(/\b(?:adapter|cell|managed|protocol)\s*=/i)
    expect([...(canvasInvocation ?? '').matchAll(/\b([A-Za-z][A-Za-z0-9]*)=/g)]
      .map((match) => match[1])
      .sort()).toEqual(['canvas', 'dependencies', 'hostScopeKey'])
  })

  test('keeps public contract packages free of private Omnidraw dependencies', async () => {
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

  test('keeps durable Cangine scene writes behind CanvasDocumentService', async () => {
    const allowedWriters = new Map([
      [
        'packages/canvas/src/services/CanvasDocumentService.ts',
        new Set(['apply', 'replace']),
      ],
    ])
    const violations: string[] = []
    for (const root of ['apps', 'packages']) {
      for (const file of await sourceFiles(join(ROOT, root))) {
        const path = relative(ROOT, file).split(sep).join('/')
        if (
          !path.includes('/src/')
          || !JAVASCRIPT_TYPESCRIPT_EXTENSIONS.has(extname(file))
        ) continue
        const source = await readFile(file, 'utf8')
        if (!source.includes('scene')) continue
        for (const write of durableSceneWrites(path, source)) {
          if (allowedWriters.get(path)?.has(write.method) === true) continue
          violations.push(
            `${path}:${write.line}:${write.column} calls scene.${write.method}()`,
          )
        }
      }
    }
    expect(violations).toEqual([])
  })

  test('detects direct, computed, and aliased durable scene writes', () => {
    const writes = durableSceneWrites('fixture.ts', `
      engine.scene.apply(commands)
      const projected = engine.scene
      projected['replace'](snapshot)
      const { transaction: mutate } = projected
      mutate(callback)
      const direct = projected.apply
      direct(commands)
      projected[method](commands)
    `)
    expect(writes.map(({ method }) => method)).toEqual([
      'apply',
      'replace',
      'transaction',
      'apply',
      '<computed>',
    ])
  })

})
