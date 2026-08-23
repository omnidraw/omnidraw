/** @file Pure canonical server-module construction, integrity, and portability policy. */

import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import {
  WIDGET_SERVER_FUNCTION_COUNT_MAX,
  WIDGET_SERVER_MODULE_ABI,
  WIDGET_SERVER_MODULE_FORMAT,
  WIDGET_SERVER_MODULE_MAX_BYTES,
} from '../CONSTANTS';
import type {
  TWidgetServerFunctionDescriptor,
  TWidgetServerModuleArtifact,
} from '../types';
import {
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnNormalizeWidgetServerFunctionDescriptors,
} from './fn.function-descriptor';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const traverse: typeof traverseModule = typeof traverseModule === 'function'
  ? traverseModule
  : (traverseModule as unknown as Readonly<{ default: typeof traverseModule }>).default;

export type TWidgetServerModuleArtifactValidation =
  | Readonly<{ valid: true }>
  | Readonly<{
      valid: false;
      reason:
        | 'contract_mismatch'
        | 'module_size_invalid'
        | 'module_digest_mismatch'
        | 'function_count_invalid'
        | 'function_order_invalid'
        | 'function_digest_mismatch';
    }>;

type TDigestSha256 = (value: string | Uint8Array) => string;

function assertDigest(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
}

/** Creates the one canonical path-free server artifact accepted by host adapters. */
export function fnCreateWidgetServerModuleArtifact(args: Readonly<{
  moduleBytes: Uint8Array;
  functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
  digestSha256: TDigestSha256;
}>): TWidgetServerModuleArtifact {
  if (args.moduleBytes.byteLength < 1 || args.moduleBytes.byteLength > WIDGET_SERVER_MODULE_MAX_BYTES) {
    throw new TypeError('Widget server module exceeds its byte limit.');
  }
  if (
    args.functionDescriptors.length < 1
    || args.functionDescriptors.length > WIDGET_SERVER_FUNCTION_COUNT_MAX
  ) {
    throw new TypeError('Widget server module function count is invalid.');
  }
  const moduleBytes = new Uint8Array(args.moduleBytes);
  const functionDescriptors = Object.freeze(
    fnNormalizeWidgetServerFunctionDescriptors(args.functionDescriptors),
  );
  const moduleDigestSha256 = args.digestSha256(moduleBytes);
  const functionDescriptorsDigestSha256 = args.digestSha256(
    fnCanonicalizeWidgetServerFunctionDescriptors(functionDescriptors),
  );
  assertDigest(moduleDigestSha256, 'Widget server module digest');
  assertDigest(functionDescriptorsDigestSha256, 'Widget server function descriptor digest');
  return Object.freeze({
    kind: 'server_module',
    format: WIDGET_SERVER_MODULE_FORMAT,
    abi: WIDGET_SERVER_MODULE_ABI,
    moduleBytes,
    moduleDigestSha256,
    functionDescriptors,
    functionDescriptorsDigestSha256,
  });
}

/** Recomputes every content identity without accepting adapter-selected metadata. */
export function fnValidateWidgetServerModuleArtifact(args: Readonly<{
  artifact: TWidgetServerModuleArtifact;
  digestSha256: TDigestSha256;
}>): TWidgetServerModuleArtifactValidation {
  const artifact = args.artifact;
  if (
    artifact.kind !== 'server_module'
    || artifact.format !== WIDGET_SERVER_MODULE_FORMAT
    || artifact.abi !== WIDGET_SERVER_MODULE_ABI
  ) return { valid: false, reason: 'contract_mismatch' };
  if (
    !(artifact.moduleBytes instanceof Uint8Array)
    || artifact.moduleBytes.byteLength < 1
    || artifact.moduleBytes.byteLength > WIDGET_SERVER_MODULE_MAX_BYTES
  ) return { valid: false, reason: 'module_size_invalid' };
  if (
    !SHA256_PATTERN.test(artifact.moduleDigestSha256)
    || args.digestSha256(artifact.moduleBytes) !== artifact.moduleDigestSha256
  ) return { valid: false, reason: 'module_digest_mismatch' };
  if (
    artifact.functionDescriptors.length < 1
    || artifact.functionDescriptors.length > WIDGET_SERVER_FUNCTION_COUNT_MAX
  ) return { valid: false, reason: 'function_count_invalid' };
  const normalized = fnNormalizeWidgetServerFunctionDescriptors(
    artifact.functionDescriptors,
  );
  if (JSON.stringify(normalized) !== JSON.stringify(artifact.functionDescriptors)) {
    return { valid: false, reason: 'function_order_invalid' };
  }
  if (
    !SHA256_PATTERN.test(artifact.functionDescriptorsDigestSha256)
    || args.digestSha256(fnCanonicalizeWidgetServerFunctionDescriptors(normalized))
      !== artifact.functionDescriptorsDigestSha256
  ) return { valid: false, reason: 'function_digest_mismatch' };
  return { valid: true };
}

export type TWidgetServerModulePolicyPhase = 'authored_source' | 'closed_bundle';

export type TWidgetServerModulePolicyToken =
  | 'adapter_module'
  | 'commonjs_loader'
  | 'dynamic_code_generation'
  | 'dynamic_import'
  | 'environment'
  | 'entropy'
  | 'filesystem'
  | 'import_attributes'
  | 'module_loader'
  | 'native_addon'
  | 'network'
  | 'os'
  | 'process'
  | 'shared_memory'
  | 'socket'
  | 'static_import'
  | 'subprocess'
  | 'timer'
  | 'webassembly'
  | 'worker_adapter_global';

export type TWidgetServerModulePolicyAdmission =
  | Readonly<{ allowed: true }>
  | Readonly<{
      allowed: false;
      phase: TWidgetServerModulePolicyPhase;
      token: TWidgetServerModulePolicyToken;
    }>;

const FORBIDDEN_SPECIFIERS: readonly Readonly<{
  token: TWidgetServerModulePolicyToken;
  pattern: RegExp;
}>[] = Object.freeze([
  { token: 'adapter_module', pattern: /^(?:bun:|cloudflare:|wrangler(?:\/|$)|workerd(?:\/|$)|miniflare(?:\/|$)|@cloudflare\/|@tursodatabase\/serverless(?:\/|$))/ },
  { token: 'filesystem', pattern: /^(?:node:)?(?:fs|fs\/promises|path)$/ },
  { token: 'os', pattern: /^(?:node:)?(?:os|tty|util)$/ },
  { token: 'subprocess', pattern: /^(?:node:)?(?:child_process|cluster|worker_threads)$/ },
  { token: 'socket', pattern: /^(?:node:)?(?:dgram|dns|http|https|http2|net|tls)$/ },
  { token: 'module_loader', pattern: /^(?:node:)?(?:module|vm)$/ },
  { token: 'native_addon', pattern: /\.node$/ },
  { token: 'adapter_module', pattern: /^node:/ },
]);

const FORBIDDEN_CODE: readonly Readonly<{
  token: TWidgetServerModulePolicyToken;
  pattern: RegExp;
}>[] = Object.freeze([
  { token: 'import_attributes', pattern: /\b(?:import|export)\b[\s\S]*?\b(?:with|assert)\s*\{/ },
  { token: 'dynamic_import', pattern: /\bimport\s*\(/ },
  { token: 'dynamic_code_generation', pattern: /\beval\s*\(|\b(?:new\s+)?Function\s*\(/ },
  { token: 'commonjs_loader', pattern: /\brequire\s*\(|\bmodule\s*\.\s*exports\b|\bexports\s*\./ },
  { token: 'module_loader', pattern: /\bimport\s*\.\s*meta\b/ },
  { token: 'environment', pattern: /\b(?:process\s*\.\s*env|Deno\s*\.\s*env)\b/ },
  { token: 'process', pattern: /\b(?:process|Bun|Deno)\b/ },
  { token: 'filesystem', pattern: /\b(?:FileSystemFileHandle|FileSystemDirectoryHandle)\b/ },
  { token: 'subprocess', pattern: /\b(?:ChildProcess|Worker)\b/ },
  { token: 'socket', pattern: /\b(?:WebSocket|TCPSocket|UDPSocket)\b/ },
  { token: 'network', pattern: /\b(?:fetch|EventSource|XMLHttpRequest)\b/ },
  { token: 'webassembly', pattern: /\bWebAssembly\b/ },
  { token: 'worker_adapter_global', pattern: /\b(?:globalThis|self|console|navigator|caches|waitUntil|checkpoint|schedule|scheduleAt|scheduleAfter)\b/ },
  { token: 'timer', pattern: /\b(?:setTimeout|setInterval|setImmediate|queueMicrotask|Date|performance)\b/ },
  { token: 'shared_memory', pattern: /\b(?:SharedArrayBuffer|Atomics)\b/ },
  { token: 'entropy', pattern: /\bcrypto\b/ },
]);

const PORTABLE_ECMASCRIPT_GLOBALS = new Set([
  'AggregateError',
  'Array',
  'ArrayBuffer',
  'BigInt',
  'BigInt64Array',
  'BigUint64Array',
  'Boolean',
  'DataView',
  'Date',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'Error',
  'EvalError',
  'Float32Array',
  'Float64Array',
  'Infinity',
  'Int8Array',
  'Int16Array',
  'Int32Array',
  'isFinite',
  'isNaN',
  'JSON',
  'Map',
  'Math',
  'NaN',
  'Number',
  'Object',
  'parseFloat',
  'parseInt',
  'Promise',
  'Proxy',
  'RangeError',
  'ReferenceError',
  'RegExp',
  'Reflect',
  'Set',
  'String',
  'Symbol',
  'SyntaxError',
  'TypeError',
  'Uint8Array',
  'Uint8ClampedArray',
  'Uint16Array',
  'Uint32Array',
  'undefined',
  'URIError',
  'WeakMap',
  'WeakSet',
]);

type TAstPolicyAnalysis = Readonly<{
  moduleSpecifiers: readonly string[];
  hasStaticImport: boolean;
  hasImportAttributes: boolean;
  hasDynamicCode: boolean;
  hasConstructorAccess: boolean;
  hasEnvironmentAccess: boolean;
  hasTimerAccess: boolean;
  hasWorkerAdapterGlobalAccess: boolean;
  unboundGlobals: readonly string[];
}>;

function stringNodeValue(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as Readonly<{ value?: unknown }>;
  return typeof candidate.value === 'string' ? candidate.value : null;
}

/**
 * The parser is the authority for lexical scope and module syntax. Regexes
 * below remain narrow defense-in-depth classifiers, not a substitute parser.
 */
function astPolicyAnalysis(
  source: string,
  phase: TWidgetServerModulePolicyPhase,
): TAstPolicyAnalysis | null {
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, {
      sourceType: 'module',
      plugins: [
        'decorators-legacy',
        'explicitResourceManagement',
        'importAttributes',
        'jsx',
        'typescript',
      ],
    });
  } catch {
    return null;
  }

  const specifiers = new Set<string>();
  const unboundGlobals = new Set<string>();
  let hasStaticImport = false;
  let hasImportAttributes = false;
  let hasDynamicCode = false;
  let hasConstructorAccess = false;
  let hasEnvironmentAccess = false;
  let hasTimerAccess = false;
  let hasWorkerAdapterGlobalAccess = false;
  const constructorAccessDenied = (path: Readonly<{
    parentPath?: unknown;
    node: unknown;
  }>): boolean => {
    if (phase === 'authored_source') return true;
    const parent = path.parentPath as Readonly<{
      isCallExpression(): boolean;
      isNewExpression(): boolean;
      node: unknown;
    }> | null | undefined;
    const parentNode = parent?.node as Readonly<{ callee?: unknown }> | undefined;
    return (
      (parent?.isCallExpression() === true || parent?.isNewExpression() === true)
      && parentNode?.callee === path.node
    );
  };

  traverse(ast, {
    ImportDeclaration(path) {
      hasStaticImport = true;
      const specifier = stringNodeValue(path.node.source);
      if (specifier !== null) specifiers.add(specifier);
      const node = path.node as typeof path.node & Readonly<{
        assertions?: readonly unknown[];
        attributes?: readonly unknown[];
      }>;
      if ((node.assertions?.length ?? 0) > 0 || (node.attributes?.length ?? 0) > 0) {
        hasImportAttributes = true;
      }
    },
    ExportAllDeclaration(path) {
      hasStaticImport = true;
      const specifier = stringNodeValue(path.node.source);
      if (specifier !== null) specifiers.add(specifier);
      const node = path.node as typeof path.node & Readonly<{
        assertions?: readonly unknown[];
        attributes?: readonly unknown[];
      }>;
      if ((node.assertions?.length ?? 0) > 0 || (node.attributes?.length ?? 0) > 0) {
        hasImportAttributes = true;
      }
    },
    ExportNamedDeclaration(path) {
      if (path.node.source === null) return;
      hasStaticImport = true;
      const specifier = stringNodeValue(path.node.source);
      if (specifier !== null) specifiers.add(specifier);
      const node = path.node as typeof path.node & Readonly<{
        assertions?: readonly unknown[];
        attributes?: readonly unknown[];
      }>;
      if ((node.assertions?.length ?? 0) > 0 || (node.attributes?.length ?? 0) > 0) {
        hasImportAttributes = true;
      }
    },
    ReferencedIdentifier(path) {
      if (path.findParent((candidate) => candidate.isTSType())) return;
      const name = path.node.name;
      if (
        (name === 'eval' || name === 'Function')
        && !path.scope.hasBinding(name, true)
      ) {
        const parent = path.parentPath;
        const directlyInvoked = (
          (parent?.isCallExpression() === true || parent?.isNewExpression() === true)
          && parent.node.callee === path.node
        );
        if (phase === 'authored_source' || directlyInvoked) hasDynamicCode = true;
        return;
      }
      if (name === 'Date' && !path.scope.hasBinding(name, true)) {
        const parent = path.parentPath;
        const currentTimeCall = parent?.isCallExpression() === true
          && parent.node.callee === path.node;
        const currentTimeConstruction = parent?.isNewExpression() === true
          && parent.node.callee === path.node
          && parent.node.arguments.length === 0;
        const nowAccess = parent?.isMemberExpression() === true
          && parent.node.object === path.node
          && parent.node.computed === false
          && parent.node.property.type === 'Identifier'
          && parent.node.property.name === 'now';
        if (
          phase === 'authored_source'
          || currentTimeCall
          || currentTimeConstruction
          || nowAccess
        ) hasTimerAccess = true;
        return;
      }
      if (name === 'globalThis' && phase === 'closed_bundle') {
        return;
      }
      if (!path.scope.hasBinding(name, true) && !PORTABLE_ECMASCRIPT_GLOBALS.has(name)) {
        unboundGlobals.add(name);
      }
    },
    MemberExpression(path) {
      const propertyEvaluation = path.node.computed
        ? path.get('property').evaluate()
        : null;
      const propertyName = path.node.computed
        ? (propertyEvaluation?.confident === true ? propertyEvaluation.value : null)
        : path.node.property.type === 'Identifier'
          ? path.node.property.name
          : null;
      if (
        path.node.object.type === 'Identifier'
        && path.node.object.name === 'globalThis'
        && !path.scope.hasBinding('globalThis', true)
        && (
          (path.node.computed && typeof propertyName !== 'string')
          || (typeof propertyName === 'string' && !PORTABLE_ECMASCRIPT_GLOBALS.has(propertyName))
        )
      ) {
        hasWorkerAdapterGlobalAccess = true;
      }
      if (
        path.node.object.type === 'Identifier'
        && (path.node.object.name === 'process' || path.node.object.name === 'Deno')
        && propertyName === 'env'
        && !path.scope.hasBinding(path.node.object.name, true)
      ) hasEnvironmentAccess = true;
      if (
        path.node.object.type === 'Identifier'
        && path.node.object.name === 'globalThis'
        && propertyName === 'Date'
      ) {
        const parent = path.parentPath;
        const currentTimeCall = parent?.isCallExpression() === true
          && parent.node.callee === path.node;
        const currentTimeConstruction = parent?.isNewExpression() === true
          && parent.node.callee === path.node
          && parent.node.arguments.length === 0;
        const nowAccess = parent?.isMemberExpression() === true
          && parent.node.object === path.node
          && parent.node.computed === false
          && parent.node.property.type === 'Identifier'
          && parent.node.property.name === 'now';
        if (currentTimeCall || currentTimeConstruction || nowAccess) hasTimerAccess = true;
      }
      if (!path.node.computed) {
        if (
          path.node.property.type === 'Identifier'
          && path.node.property.name === 'constructor'
          && constructorAccessDenied(path)
        ) {
          hasConstructorAccess = true;
        }
        return;
      }
      if (
        propertyEvaluation?.confident === true
        && propertyEvaluation.value === 'constructor'
        && constructorAccessDenied(path)
      ) {
        hasConstructorAccess = true;
      }
    },
    OptionalMemberExpression(path) {
      const evaluation = path.node.computed ? path.get('property').evaluate() : null;
      const propertyName = path.node.computed
        ? (evaluation?.confident === true ? evaluation.value : null)
        : path.node.property.type === 'Identifier'
          ? path.node.property.name
          : null;
      if (
        path.node.object.type === 'Identifier'
        && path.node.object.name === 'globalThis'
        && !path.scope.hasBinding('globalThis', true)
        && (
          (path.node.computed && typeof propertyName !== 'string')
          || (typeof propertyName === 'string' && !PORTABLE_ECMASCRIPT_GLOBALS.has(propertyName))
        )
      ) {
        hasWorkerAdapterGlobalAccess = true;
      }
      if (!path.node.computed) return;
      if (
        evaluation?.confident === true
        && evaluation.value === 'constructor'
        && constructorAccessDenied(path)
      ) {
        hasConstructorAccess = true;
      }
    },
  });

  return Object.freeze({
    moduleSpecifiers: Object.freeze([...specifiers]),
    hasStaticImport,
    hasImportAttributes,
    hasDynamicCode,
    hasConstructorAccess,
    hasEnvironmentAccess,
    hasTimerAccess,
    hasWorkerAdapterGlobalAccess,
    unboundGlobals: Object.freeze([...unboundGlobals].sort()),
  });
}

function moduleSpecifiers(sourceWithoutComments: string): readonly string[] {
  return [
    ...[...sourceWithoutComments.matchAll(/(?:^|[;\n])\s*(?:import|export)\s*(?:type\s+)?(?:[^;'"`]+?\s*from\s*)?['"]([^'"]+)['"]/g)]
      .map((match) => match[1]!),
    ...[...sourceWithoutComments.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)]
      .map((match) => match[1]!),
  ];
}

function skipPolicyTrivia(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index]!)) {
      index += 1;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      return end < 0 ? source.length : skipPolicyTrivia(source, end + 2);
    }
    break;
  }
  return index;
}

function hexCodePoint(source: string, start: number, length: number): number | null {
  const text = source.slice(start, start + length);
  if (text.length !== length || !/^[0-9a-f]+$/i.test(text)) return null;
  const value = Number.parseInt(text, 16);
  return Number.isSafeInteger(value) ? value : null;
}

/** Reads one static JS string without evaluating guest text. */
function staticStringLiteral(
  source: string,
  start: number,
): Readonly<{ value: string; next: number }> | null {
  const quote = source[start];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let value = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === quote) return Object.freeze({ value, next: index + 1 });
    if (quote === '`' && character === '$' && source[index + 1] === '{') return null;
    if ((quote === "'" || quote === '"') && (character === '\n' || character === '\r')) {
      return null;
    }
    if (character !== '\\') {
      value += character;
      continue;
    }
    const escaped = source[index + 1];
    if (escaped === undefined) return null;
    index += 1;
    if (escaped === '\n') continue;
    if (escaped === '\r') {
      if (source[index + 1] === '\n') index += 1;
      continue;
    }
    const simpleEscapes: Readonly<Record<string, string>> = Object.freeze({
      b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', 0: '\0',
    });
    if (simpleEscapes[escaped] !== undefined) {
      value += simpleEscapes[escaped];
      continue;
    }
    if (escaped === 'x') {
      const codePoint = hexCodePoint(source, index + 1, 2);
      if (codePoint === null) return null;
      value += String.fromCodePoint(codePoint);
      index += 2;
      continue;
    }
    if (escaped === 'u') {
      if (source[index + 1] === '{') {
        const end = source.indexOf('}', index + 2);
        if (end < 0) return null;
        const body = source.slice(index + 2, end);
        if (!/^[0-9a-f]{1,6}$/i.test(body)) return null;
        const codePoint = Number.parseInt(body, 16);
        if (codePoint > 0x10ffff) return null;
        value += String.fromCodePoint(codePoint);
        index = end;
        continue;
      }
      const codePoint = hexCodePoint(source, index + 1, 4);
      if (codePoint === null) return null;
      value += String.fromCodePoint(codePoint);
      index += 4;
      continue;
    }
    value += escaped;
  }
  return null;
}

/** Resolves only a side-effect-free concatenation of static string literals. */
function staticComputedProperty(source: string, bracket: number): string | null {
  let index = skipPolicyTrivia(source, bracket + 1);
  let value = '';
  let literals = 0;
  while (index < source.length) {
    const literal = staticStringLiteral(source, index);
    if (literal === null) return null;
    value += literal.value;
    literals += 1;
    index = skipPolicyTrivia(source, literal.next);
    if (source[index] === ']') return literals > 0 ? value : null;
    if (source[index] !== '+') return null;
    index = skipPolicyTrivia(source, index + 1);
  }
  return null;
}

function codeWithoutCommentsAndStrings(source: string): Readonly<{
  code: string;
  sourceWithoutComments: string;
  hasComputedConstructorAccess: boolean;
}> {
  let result = '';
  let sourceWithoutComments = '';
  let quote: "'" | '"' | '`' | null = null;
  let lineComment = false;
  let blockComment = false;
  let escaped = false;
  let hasComputedConstructorAccess = false;
  const templateExpressionDepths: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1];
    if (lineComment) {
      if (character === '\n') {
        lineComment = false;
        result += '\n';
        sourceWithoutComments += '\n';
      } else {
        result += ' ';
        sourceWithoutComments += ' ';
      }
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        result += '  ';
        sourceWithoutComments += '  ';
        index += 1;
      } else {
        result += character === '\n' ? '\n' : ' ';
        sourceWithoutComments += character === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (quote === '`' && character === '$' && next === '{') {
        quote = null;
        templateExpressionDepths.push(1);
        result += '  ';
        sourceWithoutComments += '${';
        index += 1;
        continue;
      }
      else if (character === quote) {
        quote = null;
      }
      result += character === '\n' ? '\n' : ' ';
      sourceWithoutComments += character;
      continue;
    }
    if (templateExpressionDepths.length > 0 && character === '{') {
      templateExpressionDepths[templateExpressionDepths.length - 1]! += 1;
      result += character;
      sourceWithoutComments += character;
      continue;
    }
    if (templateExpressionDepths.length > 0 && character === '}') {
      const current = templateExpressionDepths.length - 1;
      templateExpressionDepths[current]! -= 1;
      if (templateExpressionDepths[current] === 0) {
        templateExpressionDepths.pop();
        quote = '`';
        result += ' ';
      } else result += character;
      sourceWithoutComments += character;
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      result += '  ';
      sourceWithoutComments += '  ';
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      result += '  ';
      sourceWithoutComments += '  ';
      index += 1;
      continue;
    }
    if (character === '[' && staticComputedProperty(source, index) === 'constructor') {
      hasComputedConstructorAccess = true;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      result += ' ';
      sourceWithoutComments += character;
      continue;
    }
    result += character;
    sourceWithoutComments += character;
  }
  return Object.freeze({ code: result, sourceWithoutComments, hasComputedConstructorAccess });
}

/** Applies the same fixed capability profile before bundling and to closed output. */
export function fnWidgetServerModulePolicyAdmission(args: Readonly<{
  phase: TWidgetServerModulePolicyPhase;
  source: string;
}>): TWidgetServerModulePolicyAdmission {
  const astAnalysis = astPolicyAnalysis(args.source, args.phase);
  const sanitized = codeWithoutCommentsAndStrings(args.source);
  const specifiers = new Set([
    ...(astAnalysis?.moduleSpecifiers ?? []),
    ...moduleSpecifiers(sanitized.sourceWithoutComments),
  ]);
  for (const specifier of specifiers) {
    const rule = FORBIDDEN_SPECIFIERS.find((candidate) => candidate.pattern.test(specifier));
    if (rule !== undefined) return { allowed: false, phase: args.phase, token: rule.token };
  }
  const code = sanitized.code;
  if (
    args.phase === 'closed_bundle'
    && (
      astAnalysis?.hasStaticImport === true
      || /(?:^|[;\n])\s*(?:import\s+(?!\.)|export\s+(?:\*|\{[^}]*\})\s+from\b)/m.test(code)
    )
  ) return { allowed: false, phase: args.phase, token: 'static_import' };
  if (astAnalysis?.hasImportAttributes === true) {
    return { allowed: false, phase: args.phase, token: 'import_attributes' };
  }
  if (astAnalysis?.hasEnvironmentAccess === true) {
    return { allowed: false, phase: args.phase, token: 'environment' };
  }
  if (astAnalysis?.hasTimerAccess === true) {
    return { allowed: false, phase: args.phase, token: 'timer' };
  }
  if (astAnalysis?.hasWorkerAdapterGlobalAccess === true) {
    return { allowed: false, phase: args.phase, token: 'worker_adapter_global' };
  }
  if (
    astAnalysis?.hasConstructorAccess === true
    || (
      args.phase === 'authored_source'
      && (sanitized.hasComputedConstructorAccess || /\bconstructor\b/.test(code))
    )
  ) {
    return { allowed: false, phase: args.phase, token: 'dynamic_code_generation' };
  }
  if (astAnalysis?.hasDynamicCode === true) {
    return { allowed: false, phase: args.phase, token: 'dynamic_code_generation' };
  }
  for (const rule of FORBIDDEN_CODE) {
    if (
      astAnalysis !== null
      && args.phase === 'closed_bundle'
      && (
        rule.token === 'dynamic_code_generation'
        || rule.token === 'worker_adapter_global'
        || rule.token === 'timer'
      )
    ) continue;
    if (rule.pattern.test(code)) {
      return { allowed: false, phase: args.phase, token: rule.token };
    }
  }
  if (
    astAnalysis?.unboundGlobals.includes('process') === true
    || astAnalysis?.unboundGlobals.includes('Bun') === true
    || astAnalysis?.unboundGlobals.includes('Deno') === true
  ) return { allowed: false, phase: args.phase, token: 'process' };
  if ((astAnalysis?.unboundGlobals.length ?? 0) > 0) {
    return { allowed: false, phase: args.phase, token: 'worker_adapter_global' };
  }
  return { allowed: true };
}
