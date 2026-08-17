#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  constants,
} from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  WIDGET_BUILD_RECEIPT_PATH,
  WIDGET_SERVER_ALLOWED_PACKAGE_IMPORTS,
  ZWidgetManifestV1,
  fnCanonicalizeWidgetBuildReceipt,
  fnCanonicalizeWidgetExecutableProjection,
  fnCreateWidgetBuildReceipt,
  fnProjectWidgetExecutableManifest,
  fnWidgetServerModulePolicyAdmission,
  fnWidgetManifestV1Digest,
  fnWidgetPortableExecutableInputDigest,
  fnWidgetPortableSourceDigest,
  parseWidgetManifestV1Json,
} from './contracts/index.js';
import {
  WIDGET_BUILD_FILE_COUNT_MAX,
  WIDGET_BUILD_FILE_MAX_BYTES,
  WIDGET_BUILD_TOTAL_BYTES_MAX,
} from './contracts/CONSTANTS.js';
import {
  fnCreateOfflineCheckDiagnostic,
  fnCreateOfflineCheckReport,
  fnOfflineCheckExitCode,
  fnRenderOfflineCheckHuman,
  fnRenderOfflineCheckJson,
} from './fn.offline-check.js';
import {
  fnBootstrapWidgetUiEntry,
  fnWidgetGuestBridgeBootstrapSource,
  fnWidgetPortableViteConfigSource,
} from './fn.portable-build.js';
import { runSdkAsync } from './internal/effect-runtime.js';

const SDK_VERSION = __OMNIDRAW_SDK_VERSION__;
const INTERNAL_DIRECTORY = '.omnidraw';
const BUILD_LOCK_DIRECTORY = 'build.lock';
const LOCK_STALE_MS = 120_000;
const LOCK_HEARTBEAT_MS = 5_000;
const EXCLUDED_DIRECTORIES = new Set(['.git', '.omnidraw', 'dist', 'node_modules', 'server-dist']);
const MANIFEST_PATH = 'omnidraw.json';
const GUEST_BRIDGE_PATH = '__omnidraw_guest_bridge__.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeRelativePath(path) {
  return path.length > 0
    && path.length <= 1_024
    && !path.includes('\\')
    && !path.includes('\0')
    && !path.startsWith('/')
    && !/^[A-Za-z]:/.test(path)
    && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function sameStat(left, right) {
  return right.isFile()
    && Number(left.dev) === Number(right.dev)
    && Number(left.ino) === Number(right.ino)
    && Number(left.size) === Number(right.size)
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

async function captureProjectFiles(root) {
  const files = [];
  const directories = [];
  let totalBytes = 0;
  const visit = async (hostDirectory, relativeDirectory, depth) => {
    if (depth > 32) throw new Error('Widget project exceeds the directory depth limit.');
    const before = await lstat(hostDirectory);
    if (!before.isDirectory() || before.isSymbolicLink()) {
      throw new Error('Widget project contains an unsafe directory.');
    }
    const entries = (await readdir(hostDirectory, { withFileTypes: true }))
      .sort((left, right) => compareText(left.name, right.name));
    directories.push({
      path: hostDirectory,
      entries: entries.map((entry) => `${entry.name}\0${entry.isDirectory() ? 'd' : entry.isFile() ? 'f' : 'x'}`).join('\0'),
      stat: before,
      relativeDirectory,
    });
    for (const entry of entries) {
      if (relativeDirectory === '' && entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      if (relativeDirectory === '' && entry.name === '.DS_Store') continue;
      const relativePath = relativeDirectory === '' ? entry.name : `${relativeDirectory}/${entry.name}`;
      if (!safeRelativePath(relativePath)) throw new Error(`Widget project contains unsafe path '${relativePath}'.`);
      const path = join(hostDirectory, entry.name);
      const observed = await lstat(path);
      if (observed.isSymbolicLink()) throw new Error(`Widget project symlink '${relativePath}' is not allowed.`);
      if (observed.isDirectory()) {
        await visit(path, relativePath, depth + 1);
        continue;
      }
      if (!observed.isFile()) throw new Error(`Widget project entry '${relativePath}' is not a regular file.`);
      if (observed.size > WIDGET_BUILD_FILE_MAX_BYTES) throw new Error(`Widget project file '${relativePath}' exceeds the byte limit.`);
      totalBytes += observed.size;
      if (totalBytes > WIDGET_BUILD_TOTAL_BYTES_MAX) throw new Error('Widget project exceeds the total byte limit.');
      if (files.length >= WIDGET_BUILD_FILE_COUNT_MAX + 1) throw new Error('Widget project exceeds the file-count limit.');
      files.push({ path: relativePath, hostPath: path, stat: observed });
    }
  };
  await visit(root, '', 0);

  const captured = [];
  for (const file of files) {
    const handle = await open(file.hostPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat();
      if (!sameStat(file.stat, before)) throw new Error(`Widget project file '${file.path}' changed before capture.`);
      const bytes = await handle.readFile();
      const after = await handle.stat();
      const pathAfter = await lstat(file.hostPath);
      if (!sameStat(file.stat, after) || !sameStat(file.stat, pathAfter) || bytes.byteLength !== file.stat.size) {
        throw new Error(`Widget project file '${file.path}' changed during capture.`);
      }
      captured.push(Object.freeze({ path: file.path, bytes: new Uint8Array(bytes) }));
    } finally {
      await handle.close();
    }
  }
  for (const directory of directories.reverse()) {
    const observed = await lstat(directory.path);
    const entries = (await readdir(directory.path, { withFileTypes: true }))
      .sort((left, right) => compareText(left.name, right.name))
      .map((entry) => `${entry.name}\0${entry.isDirectory() ? 'd' : entry.isFile() ? 'f' : 'x'}`).join('\0');
    if (!observed.isDirectory() || observed.isSymbolicLink() || entries !== directory.entries) {
      throw new Error(`Widget project directory '${directory.relativeDirectory || '.'}' changed during capture.`);
    }
  }
  return Object.freeze(captured);
}

async function captureProject(root) {
  const captured = await captureProjectFiles(root);
  const manifestFile = captured.find((file) => file.path === MANIFEST_PATH);
  if (manifestFile === undefined) throw new Error('Widget project is missing omnidraw.json.');
  const manifest = parseWidgetManifestV1Json(new TextDecoder('utf-8', { fatal: true }).decode(manifestFile.bytes));
  const sourceFiles = Object.freeze(captured.filter((file) => file.path !== MANIFEST_PATH));
  return Object.freeze({ manifest, sourceFiles });
}

async function materialize(files, root) {
  for (const file of files) {
    const destination = join(root, ...file.path.split('/'));
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, file.bytes, { flag: 'wx', mode: 0o600 });
  }
}

async function syncDirectory(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

async function outputFiles(root, relativeDirectory = '') {
  const directory = relativeDirectory === '' ? root : join(root, ...relativeDirectory.split('/'));
  const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => compareText(left.name, right.name));
  const files = [];
  for (const entry of entries) {
    const relativePath = relativeDirectory === '' ? entry.name : `${relativeDirectory}/${entry.name}`;
    const path = join(directory, entry.name);
    const value = await lstat(path);
    if (value.isSymbolicLink() || (!value.isDirectory() && !value.isFile())) {
      throw new Error(`Widget build output '${relativePath}' is not a regular file or directory.`);
    }
    if (value.isDirectory()) {
      files.push(...await outputFiles(root, relativePath));
      continue;
    }
    if (value.size > WIDGET_BUILD_FILE_MAX_BYTES) throw new Error(`Widget build output '${relativePath}' exceeds the byte limit.`);
    const bytes = new Uint8Array(await readFile(path));
    files.push(Object.freeze({
      path: `dist/${relativePath}`,
      byteSize: bytes.byteLength,
      sha256: sha256(bytes),
      hostPath: path,
    }));
  }
  return files;
}

function sanitizedBuildEnvironment(root) {
  const environment = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || /^OMNIDRAW_/i.test(name)) continue;
    environment[name] = value;
  }
  environment.INIT_CWD = root;
  return environment;
}

async function runVite(projectRoot, stageRoot, configPath) {
  const viteBin = join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  await access(viteBin, constants.R_OK).catch(() => {
    throw new Error("Portable build requires the project's declared Vite dependency to be installed.");
  });
  await new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [viteBin, 'build', '--config', configPath], {
      cwd: stageRoot,
      env: sanitizedBuildEnvironment(projectRoot),
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`Portable Vite build failed (${signal === null ? `exit ${String(code)}` : `signal ${signal}`}).`));
    });
  });
}

async function recoverInterruptedPromotion(projectRoot, internalRoot) {
  const liveDist = join(projectRoot, 'dist');
  const live = await lstat(liveDist).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
  const entries = await readdir(internalRoot, { withFileTypes: true });
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('previous-dist-')) continue;
    const path = join(internalRoot, entry.name);
    backups.push({ path, modifiedAtMs: (await stat(path)).mtimeMs });
  }
  backups.sort((left, right) => right.modifiedAtMs - left.modifiedAtMs);
  if (live === null && backups.length > 0) await rename(backups[0].path, liveDist);
  for (const backup of backups) {
    if (backup.path === backups[0]?.path && live === null) continue;
    await rm(backup.path, { recursive: true, force: true });
  }
}

async function acquireBuildLock(internalRoot) {
  const lockRoot = join(internalRoot, BUILD_LOCK_DIRECTORY);
  const ownerPath = join(lockRoot, 'owner');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockRoot, { mode: 0o700 });
      await writeFile(ownerPath, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
      const heartbeat = setInterval(() => {
        const now = new Date();
        void utimes(ownerPath, now, now).catch(() => undefined);
      }, LOCK_HEARTBEAT_MS);
      heartbeat.unref();
      return async () => {
        clearInterval(heartbeat);
        await rm(lockRoot, { recursive: true, force: true });
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const observed = await stat(ownerPath).catch(() => stat(lockRoot));
      if (Date.now() - observed.mtimeMs <= LOCK_STALE_MS || attempt > 0) {
        throw Object.assign(new Error('Another portable widget build is already running.'), { code: 'BUILD_BUSY' });
      }
      await rename(lockRoot, join(internalRoot, `stale-lock-${randomUUID()}`)).catch((renameError) => {
        if (renameError?.code !== 'ENOENT') throw renameError;
      });
    }
  }
  throw new Error('Portable build lock could not be acquired.');
}

function widgetLocation(path) {
  return path === '' ? 'widget://.' : `widget://${path}`;
}

function sanitizeDiagnosticText(value, projectRoot = '') {
  let result = String(value ?? 'Offline validation failed.');
  if (projectRoot !== '') result = result.split(projectRoot).join('widget://');
  return result
    .replace(/file:\/\/[^\s)]+/g, 'widget://external')
    .replace(/\/(?:Users|home|private|var|tmp|opt|usr)\/[^\s:)]+/g, 'widget://external')
    .replace(/[A-Za-z]:\\[^\s:)]+/g, 'widget://external')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function projectFailureCode(message) {
  if (message.includes('symlink')) return 'PROJECT_SYMLINK_UNSAFE';
  if (message.includes('regular file')) return 'PROJECT_SPECIAL_FILE_UNSAFE';
  if (message.includes('file-count')) return 'PROJECT_FILE_COUNT_EXCEEDED';
  if (message.includes('byte limit') || message.includes('total byte')) return 'PROJECT_BYTES_EXCEEDED';
  if (message.includes('changed')) return 'PROJECT_CHANGED_DURING_CHECK';
  if (message.includes('directory depth')) return 'PROJECT_DEPTH_EXCEEDED';
  if (message.includes('unsafe path')) return 'PROJECT_PATH_UNSAFE';
  return 'PROJECT_INVALID';
}

function manifestIssueCode(issue) {
  const path = issue.path.map(String);
  if (path.at(-1) === 'resourceId') return 'RESOURCE_ID_INVALID';
  if (path.includes('resources') && path.at(-1) === 'slot') return 'RESOURCE_SLOT_INVALID';
  if (path.includes('operations')) return 'RESOURCE_OPERATION_INVALID';
  if (path.includes('resources')) return 'RESOURCE_DECLARATION_INVALID';
  return 'MANIFEST_INVALID';
}

function safeConfigPattern(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 1_024
    && !value.includes('\\')
    && !value.includes('\0')
    && !isAbsolute(value)
    && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
    && value.split('/').every((segment) => segment !== '..' && segment !== '');
}

function validateProjectMetadata(files, diagnostics) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const path of ['package.json', 'tsconfig.json']) {
    const file = files.get(path);
    if (file === undefined) {
      diagnostics.push(fnCreateOfflineCheckDiagnostic({
        phase: 'project',
        code: path === 'package.json' ? 'PACKAGE_MISSING' : 'TSCONFIG_MISSING',
        summary: `Widget project is missing ${path}.`,
        file: widgetLocation(path),
      }));
    }
  }
  const packageFile = files.get('package.json');
  if (packageFile !== undefined) {
    try {
      const value = JSON.parse(decoder.decode(packageFile.bytes));
      if (
        value === null
        || typeof value !== 'object'
        || Array.isArray(value)
        || value.scripts?.check !== 'omnidraw-widget check .'
        || value.scripts?.build !== 'omnidraw-widget build .'
        || typeof value.dependencies?.['@omnidraw/sdk'] !== 'string'
      ) {
        throw new Error('package.json must declare the portable SDK and exact check/build scripts.');
      }
    } catch (error) {
      diagnostics.push(fnCreateOfflineCheckDiagnostic({
        phase: 'project',
        code: 'PACKAGE_CONTRACT_INVALID',
        summary: error instanceof Error ? error.message : 'package.json is invalid.',
        file: widgetLocation('package.json'),
      }));
    }
  }
  const configFile = files.get('tsconfig.json');
  if (configFile === undefined) return;
  try {
    const value = JSON.parse(decoder.decode(configFile.bytes));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('tsconfig.json must contain an object.');
    }
    const allowedRootKeys = new Set(['$schema', 'compilerOptions', 'include', 'exclude', 'files']);
    const unknownRootKey = Object.keys(value).find((key) => !allowedRootKeys.has(key));
    if (unknownRootKey !== undefined) {
      throw new Error(`tsconfig.json field '${unknownRootKey}' is not portable.`);
    }
    const compilerOptions = value.compilerOptions ?? {};
    if (compilerOptions === null || typeof compilerOptions !== 'object' || Array.isArray(compilerOptions)) {
      throw new Error('tsconfig.json compilerOptions must contain an object.');
    }
    const unsafeCompilerKeys = [
      'baseUrl', 'declarationDir', 'outDir', 'paths', 'plugins', 'rootDir',
      'rootDirs', 'tsBuildInfoFile', 'typeRoots',
    ];
    const unsafeCompilerKey = unsafeCompilerKeys.find((key) => key in compilerOptions);
    if (unsafeCompilerKey !== undefined) {
      throw new Error(`tsconfig.json compiler option '${unsafeCompilerKey}' is not portable.`);
    }
    for (const key of ['include', 'exclude', 'files']) {
      const values = value[key];
      if (values === undefined) continue;
      if (!Array.isArray(values) || values.length > 256 || values.some((entry) => !safeConfigPattern(entry))) {
        throw new Error(`tsconfig.json ${key} contains an unsafe path pattern.`);
      }
    }
  } catch (error) {
    diagnostics.push(fnCreateOfflineCheckDiagnostic({
      phase: 'project',
      code: 'TSCONFIG_UNSAFE',
      summary: error instanceof Error ? error.message : 'tsconfig.json is invalid.',
      file: widgetLocation('tsconfig.json'),
    }));
  }
}

function propertyName(ts, property) {
  const name = property?.name;
  if (name === undefined) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function objectProperties(ts, expression) {
  if (!ts.isObjectLiteralExpression(expression)) return null;
  const result = new Map();
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    const name = propertyName(ts, property);
    if (name === null || result.has(name)) return null;
    result.set(name, property.initializer);
  }
  return result;
}

function stringLiteral(ts, expression) {
  return ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)
    ? expression.text
    : null;
}

function sourceLocation(ts, sourceFile, node, path) {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    file: widgetLocation(path),
    line: location.line + 1,
    column: location.character + 1,
  };
}

function effectAllows(ceiling, requested) {
  return ceiling === 'read_write' || ceiling === requested;
}

function validateServerDescriptors(ts, sourceFile, path, manifest, diagnostics) {
  const manifestResources = new Map((manifest.resources ?? []).map((resource) => [resource.slot, resource]));
  let descriptorCount = 0;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
    if (!exported) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (
        initializer === undefined
        || !ts.isCallExpression(initializer)
        || !ts.isIdentifier(initializer.expression)
        || initializer.expression.text !== 'defineServerFunction'
      ) continue;
      descriptorCount += 1;
      const location = sourceLocation(ts, sourceFile, initializer, path);
      const config = initializer.arguments[0] === undefined
        ? null
        : objectProperties(ts, initializer.arguments[0]);
      if (config === null) {
        diagnostics.push(fnCreateOfflineCheckDiagnostic({
          phase: 'functions', code: 'FUNCTION_DESCRIPTOR_STATIC_REQUIRED',
          summary: 'defineServerFunction requires one static object-literal descriptor for offline validation.',
          ...location,
        }));
        continue;
      }
      const effect = config.get('effect') === undefined ? null : stringLiteral(ts, config.get('effect'));
      if (!['fn', 'fx', 'tx'].includes(effect)) {
        diagnostics.push(fnCreateOfflineCheckDiagnostic({
          phase: 'functions', code: 'FUNCTION_EFFECT_INVALID',
          summary: 'Server function effect must be the static value fn, fx, or tx.',
          ...location,
        }));
      }
      if (config.get('input') === undefined || config.get('output') === undefined) {
        diagnostics.push(fnCreateOfflineCheckDiagnostic({
          phase: 'functions', code: 'FUNCTION_SCHEMA_INVALID',
          summary: 'Server function descriptors must declare input and output runtime schemas.',
          ...location,
        }));
      }
      const resourcesExpression = config.get('resources');
      if (resourcesExpression === undefined) {
        if (effect !== 'fn') {
          diagnostics.push(fnCreateOfflineCheckDiagnostic({
            phase: 'functions', code: 'FUNCTION_RESOURCES_REQUIRED',
            summary: `${effect ?? 'Impure'} server functions must declare their resource slots.`,
            ...location,
          }));
        }
        continue;
      }
      const resources = objectProperties(ts, resourcesExpression);
      if (resources === null) {
        diagnostics.push(fnCreateOfflineCheckDiagnostic({
          phase: 'functions', code: 'FUNCTION_RESOURCES_STATIC_REQUIRED',
          summary: 'Server function resources must be a static object literal.',
          ...location,
        }));
        continue;
      }
      for (const [slot, expression] of resources) {
        const requestedEffect = stringLiteral(ts, expression);
        const requirement = manifestResources.get(slot);
        if (!['read', 'write', 'read_write'].includes(requestedEffect)) {
          diagnostics.push(fnCreateOfflineCheckDiagnostic({
            phase: 'functions', code: 'FUNCTION_RESOURCE_EFFECT_INVALID',
            summary: `Server function resource slot '${slot}' has an invalid effect.`,
            ...location,
          }));
        } else if (effect === 'fn' || (effect === 'fx' && requestedEffect !== 'read')) {
          diagnostics.push(fnCreateOfflineCheckDiagnostic({
            phase: 'functions', code: 'FUNCTION_EFFECT_CEILING_EXCEEDED',
            summary: `Server function resource slot '${slot}' exceeds the ${effect ?? 'invalid'} function effect.`,
            ...location,
          }));
        } else if (requirement === undefined) {
          diagnostics.push(fnCreateOfflineCheckDiagnostic({
            phase: 'functions', code: 'FUNCTION_RESOURCE_SLOT_UNDECLARED',
            summary: `Server function resource slot '${slot}' is absent from omnidraw.json.`,
            ...location,
          }));
        } else if (!effectAllows(requirement.effect, requestedEffect)) {
          diagnostics.push(fnCreateOfflineCheckDiagnostic({
            phase: 'functions', code: 'FUNCTION_RESOURCE_CEILING_EXCEEDED',
            summary: `Server function resource slot '${slot}' exceeds its manifest effect ceiling.`,
            ...location,
          }));
        }
      }
    }
  }
  if (descriptorCount === 0) {
    diagnostics.push(fnCreateOfflineCheckDiagnostic({
      phase: 'functions', code: 'FUNCTION_EXPORT_MISSING',
      summary: 'The server entry must directly export at least one defineServerFunction declaration.',
      file: widgetLocation(path),
    }));
  }
}

function staticModuleSpecifier(ts, node) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    && node.moduleSpecifier !== undefined
    && ts.isStringLiteral(node.moduleSpecifier)
  ) return node.moduleSpecifier.text;
  return null;
}

function sourceImportPaths(ts, sourceFile) {
  const imports = [];
  const visit = (node) => {
    const specifier = staticModuleSpecifier(ts, node);
    if (specifier !== null && (specifier.startsWith('./') || specifier.startsWith('../'))) {
      imports.push(specifier);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

function resolveSourceImportPath(importer, specifier, sources) {
  const base = posix.normalize(posix.join(posix.dirname(importer), specifier));
  if (!safeRelativePath(base)) return null;
  const candidates = [base];
  if (/\.(?:js|jsx|mjs|cjs)$/.test(base)) {
    const stem = base.replace(/\.(?:js|jsx|mjs|cjs)$/, '');
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`);
  } else if (!/\.(?:ts|tsx|mts|cts)$/.test(base)) {
    for (const extension of ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs']) {
      candidates.push(`${base}.${extension}`, `${base}/index.${extension}`);
    }
  }
  return candidates.find((candidate) => sources.has(candidate)) ?? null;
}

function reachableSourcePaths(ts, sources, entry) {
  const reachable = new Set();
  const pending = sources.has(entry) ? [entry] : [];
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || reachable.has(path)) continue;
    const sourceFile = sources.get(path);
    if (sourceFile === undefined) continue;
    reachable.add(path);
    for (const specifier of sourceImportPaths(ts, sourceFile)) {
      const imported = resolveSourceImportPath(path, specifier, sources);
      if (imported !== null && !reachable.has(imported)) pending.push(imported);
    }
  }
  return reachable;
}

function validateSourcePolicy(ts, sourceFile, path, isServer, uiAllowsPagehide, diagnostics) {
  const visit = (node) => {
    const specifier = staticModuleSpecifier(ts, node);
    if (specifier !== null) {
      const forbiddenNode = specifier.startsWith('node:')
        || ['fs', 'path', 'http', 'https', 'net', 'tls', 'child_process', 'worker_threads', 'bun', 'sqlite'].includes(specifier);
      const forbiddenOmnidraw = specifier.startsWith('@omnidraw/')
        && specifier !== '@omnidraw/sdk'
        && !specifier.startsWith('@omnidraw/sdk/');
      const serverSdkInUi = !isServer && specifier === '@omnidraw/sdk/server';
      const serverPackageOutsideProfile = isServer
        && !specifier.startsWith('.')
        && !specifier.startsWith('/')
        && !WIDGET_SERVER_ALLOWED_PACKAGE_IMPORTS.includes(specifier);
      if (forbiddenNode || forbiddenOmnidraw || serverSdkInUi || serverPackageOutsideProfile) {
        diagnostics.push(fnCreateOfflineCheckDiagnostic({
          phase: 'policy', code: 'SOURCE_IMPORT_FORBIDDEN',
          summary: `Source import '${specifier.slice(0, 200)}' is outside the portable widget policy.`,
          ...sourceLocation(ts, sourceFile, node, path),
        }));
      }
    }
    if (ts.isCallExpression(node)) {
      const directName = ts.isIdentifier(node.expression) ? node.expression.text : null;
      if (directName === 'require' || directName === 'fetch' || node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        diagnostics.push(fnCreateOfflineCheckDiagnostic({
          phase: 'policy', code: 'SOURCE_RUNTIME_GLOBAL_FORBIDDEN',
          summary: `Direct runtime call '${directName ?? 'import'}' is outside the portable widget policy.`,
          ...sourceLocation(ts, sourceFile, node, path),
        }));
      }
      const isWindowPagehideRegistration = !uiAllowsPagehide
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'addEventListener'
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'window'
        && node.arguments[0] !== undefined
        && stringLiteral(ts, node.arguments[0]) === 'pagehide';
      if (isWindowPagehideRegistration) {
        diagnostics.push(fnCreateOfflineCheckDiagnostic({
          phase: 'policy', code: 'SOURCE_DOM_EVENT_UNSUPPORTED',
          summary: 'window.addEventListener("pagehide", ...) is unsupported by this widget API profile. Remove it and rely on host disposal for cleanup.',
          ...sourceLocation(ts, sourceFile, node, path),
        }));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function compilerLocation(projectRoot, rawPath) {
  if (rawPath === undefined || rawPath === '') return widgetLocation('tsconfig.json');
  const absolute = isAbsolute(rawPath) ? resolve(rawPath) : resolve(projectRoot, rawPath);
  const inside = relative(projectRoot, absolute);
  if (inside !== '' && !inside.startsWith(`..${sep}`) && inside !== '..' && !isAbsolute(inside)) {
    return widgetLocation(inside.split(sep).join('/'));
  }
  return widgetLocation('dependency');
}

function compilerDiagnostics(projectRoot, output) {
  const diagnostics = [];
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const match = /^(.*?)(?:\((\d+),(\d+)\))?:\s*error\s+(TS\d+):\s*(.*)$/.exec(line);
    diagnostics.push(fnCreateOfflineCheckDiagnostic({
      phase: 'typescript',
      code: match?.[4] ?? 'TYPESCRIPT_COMPILE_FAILED',
      summary: sanitizeDiagnosticText(match?.[5] ?? line, projectRoot),
      file: compilerLocation(projectRoot, match?.[1]),
      ...(match?.[2] === undefined ? {} : { line: Number(match[2]) }),
      ...(match?.[3] === undefined ? {} : { column: Number(match[3]) }),
    }));
  }
  return diagnostics;
}

function checkEnvironment() {
  const environment = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (
      value === undefined
      || /^OMNIDRAW_/i.test(name)
      || /^(?:DATABASE_URL|TURSO_DATABASE_URL|TURSO_AUTH_TOKEN)$/i.test(name)
    ) continue;
    environment[name] = value;
  }
  return environment;
}

async function runTypeScriptCheck(projectRoot, tscPath, signal) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [
      tscPath,
      '--project', 'tsconfig.json',
      '--noEmit',
      '--pretty', 'false',
      '--incremental', 'false',
    ], {
      cwd: projectRoot,
      env: checkEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    let byteSize = 0;
    let overflow = false;
    const collect = (chunk) => {
      if (overflow) return;
      byteSize += chunk.byteLength;
      if (byteSize > 1024 * 1024) {
        overflow = true;
        child.kill('SIGTERM');
        return;
      }
      chunks.push(Buffer.from(chunk));
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const abort = () => child.kill('SIGTERM');
    signal.addEventListener('abort', abort, { once: true });
    child.once('error', reject);
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort);
      resolveRun({
        code,
        overflow,
        output: Buffer.concat(chunks).toString('utf8'),
      });
    });
  });
}

function resolveCheckRoot(requestedPath) {
  if (requestedPath.includes('\0') || isAbsolute(requestedPath)) {
    throw Object.assign(new Error('check path must be a safe relative project path.'), { code: 'CLI_INVALID' });
  }
  const projectRoot = resolve(process.cwd(), requestedPath);
  const relativeRoot = relative(process.cwd(), projectRoot);
  if (relativeRoot === '..' || relativeRoot.startsWith(`..${sep}`) || isAbsolute(relativeRoot)) {
    throw Object.assign(new Error('check path must not escape through traversal.'), { code: 'CLI_INVALID' });
  }
  return projectRoot;
}

function parseCheckArgs(args) {
  let json = false;
  const paths = [];
  for (const arg of args) {
    if (arg === '--json') {
      if (json) throw Object.assign(new Error('check accepts --json at most once.'), { code: 'CLI_INVALID' });
      json = true;
    } else if (arg.startsWith('-')) {
      throw Object.assign(new Error(`check does not support flag '${arg}'.`), { code: 'CLI_INVALID' });
    } else {
      paths.push(arg);
    }
  }
  if (paths.length > 1) throw Object.assign(new Error('check accepts zero or one project path.'), { code: 'CLI_INVALID' });
  return { json, requestedPath: paths[0] ?? '.' };
}

async function checkWidget(args, signal) {
  const parsed = parseCheckArgs(args);
  const projectRoot = resolveCheckRoot(parsed.requestedPath);
  const diagnostics = [];
  let captured;
  try {
    const root = await lstat(projectRoot);
    if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Widget project root must be a real directory.');
    captured = await captureProjectFiles(projectRoot);
  } catch (error) {
    const summary = sanitizeDiagnosticText(error instanceof Error ? error.message : 'Widget project capture failed.', projectRoot);
    diagnostics.push(fnCreateOfflineCheckDiagnostic({
      phase: 'project', code: projectFailureCode(summary), summary,
    }));
    const report = fnCreateOfflineCheckReport(diagnostics);
    process.stdout.write(parsed.json ? fnRenderOfflineCheckJson(report) : fnRenderOfflineCheckHuman(report));
    return fnOfflineCheckExitCode(report);
  }
  if (signal.aborted) throw Object.assign(new Error('Offline check was cancelled.'), { code: 'CHECK_CANCELLED' });
  const files = new Map(captured.map((file) => [file.path, file]));
  validateProjectMetadata(files, diagnostics);
  const manifestFile = files.get(MANIFEST_PATH);
  let manifest = null;
  if (manifestFile === undefined) {
    diagnostics.push(fnCreateOfflineCheckDiagnostic({
      phase: 'manifest', code: 'MANIFEST_MISSING', summary: 'Widget project is missing omnidraw.json.',
      file: widgetLocation(MANIFEST_PATH),
    }));
  } else {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(manifestFile.bytes);
      if (manifestFile.bytes.byteLength > 128 * 1024) throw new Error('omnidraw.json exceeds the 128 KiB manifest limit.');
      const json = JSON.parse(text);
      const result = ZWidgetManifestV1.safeParse(json);
      if (!result.success) {
        for (const issue of result.error.issues) {
          diagnostics.push(fnCreateOfflineCheckDiagnostic({
            phase: 'manifest', code: manifestIssueCode(issue),
            summary: issue.message,
            file: widgetLocation(MANIFEST_PATH),
          }));
        }
      } else {
        manifest = result.data;
      }
    } catch (error) {
      diagnostics.push(fnCreateOfflineCheckDiagnostic({
        phase: 'manifest', code: 'MANIFEST_JSON_INVALID',
        summary: error instanceof Error ? error.message : 'omnidraw.json is not valid UTF-8 JSON.',
        file: widgetLocation(MANIFEST_PATH),
      }));
    }
  }
  if (manifest !== null) {
    for (const [label, entry] of [['UI', manifest.ui.entry], ['server', manifest.server?.entry]]) {
      if (entry !== undefined && !files.has(entry)) {
        diagnostics.push(fnCreateOfflineCheckDiagnostic({
          phase: 'source', code: label === 'UI' ? 'UI_ENTRY_MISSING' : 'SERVER_ENTRY_MISSING',
          summary: `${label} entry '${entry}' is missing.`, file: widgetLocation(entry),
        }));
      }
    }
  }
  const typescriptPath = join(projectRoot, 'node_modules', 'typescript', 'lib', 'typescript.js');
  const tscPath = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  let ts = null;
  try {
    await access(typescriptPath, constants.R_OK);
    await access(tscPath, constants.R_OK);
    const loaded = await import(pathToFileURL(typescriptPath).href);
    ts = loaded.default ?? loaded;
  } catch {
    diagnostics.push(fnCreateOfflineCheckDiagnostic({
      phase: 'typescript', code: 'TYPESCRIPT_UNAVAILABLE',
      summary: 'The project-declared TypeScript compiler is not installed.',
      file: widgetLocation('package.json'),
    }));
  }
  if (ts !== null && manifest !== null) {
    const sourceFiles = captured.filter((candidate) => /\.[cm]?[jt]sx?$/.test(candidate.path));
    const parsedSources = new Map(sourceFiles.map((file) => {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
      const scriptKind = file.path.endsWith('.tsx')
        ? ts.ScriptKind.TSX
        : file.path.endsWith('.jsx')
          ? ts.ScriptKind.JSX
          : file.path.endsWith('.js') || file.path.endsWith('.mjs') || file.path.endsWith('.cjs')
            ? ts.ScriptKind.JS
            : ts.ScriptKind.TS;
      const sourceFile = ts.createSourceFile(file.path, text, ts.ScriptTarget.Latest, true, scriptKind);
      return [file.path, sourceFile];
    }));
    const uiSources = reachableSourcePaths(ts, parsedSources, manifest.ui.entry);
    const serverSources = manifest.server === undefined
      ? new Set()
      : reachableSourcePaths(ts, parsedSources, manifest.server.entry);
    const policyPaths = new Set([
      ...sourceFiles
        .map((file) => file.path)
        .filter((path) => /^(?:ui|server|shared|src)\//.test(path)),
      ...uiSources,
      ...serverSources,
    ]);
    for (const path of [...policyPaths].sort(compareText)) {
      const sourceFile = parsedSources.get(path);
      if (sourceFile === undefined) continue;
      validateSourcePolicy(
        ts,
        sourceFile,
        path,
        serverSources.has(path) && !uiSources.has(path),
        !uiSources.has(path) || manifest.ui.apis.includes('WEBGL'),
        diagnostics,
      );
      if (serverSources.has(path)) {
        const admission = fnWidgetServerModulePolicyAdmission({
          phase: 'authored_source',
          source: sourceFile.text,
        });
        if (!admission.allowed) {
          diagnostics.push(fnCreateOfflineCheckDiagnostic({
            phase: 'policy',
            code: 'SERVER_CAPABILITY_FORBIDDEN',
            summary: `Server source uses unsupported portable capability '${admission.token}'.`,
            file: widgetLocation(path),
          }));
        }
      }
      if (manifest.server?.entry === path) {
        validateServerDescriptors(ts, sourceFile, path, manifest, diagnostics);
      }
    }
    const compile = await runTypeScriptCheck(projectRoot, tscPath, signal);
    if (compile.overflow) {
      diagnostics.push(fnCreateOfflineCheckDiagnostic({
        phase: 'typescript', code: 'TYPESCRIPT_OUTPUT_EXCEEDED',
        summary: 'TypeScript diagnostic output exceeded the offline checker limit.',
        file: widgetLocation('tsconfig.json'),
      }));
    } else if (compile.code !== 0) {
      diagnostics.push(...compilerDiagnostics(projectRoot, compile.output));
    }
  }
  if (signal.aborted) throw Object.assign(new Error('Offline check was cancelled.'), { code: 'CHECK_CANCELLED' });
  const report = fnCreateOfflineCheckReport(diagnostics);
  process.stdout.write(parsed.json ? fnRenderOfflineCheckJson(report) : fnRenderOfflineCheckHuman(report));
  return fnOfflineCheckExitCode(report);
}

async function promoteDist(projectRoot, internalRoot, stagedDist, operationId) {
  const liveDist = join(projectRoot, 'dist');
  const backup = join(internalRoot, `previous-dist-${operationId}`);
  const existing = await lstat(liveDist).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (existing !== null) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('Existing dist must be a real directory.');
    await rename(liveDist, backup);
  }
  try {
    await rename(stagedDist, liveDist);
    await syncDirectory(projectRoot);
  } catch (error) {
    if (existing !== null) await rename(backup, liveDist).catch(() => undefined);
    throw error;
  }
  if (existing !== null) await rm(backup, { recursive: true, force: true });
}

async function buildWidget(requestedPath) {
  if (requestedPath.includes('\0')) throw new Error('Widget project path is invalid.');
  const projectRoot = resolve(process.cwd(), requestedPath);
  const relativeRoot = relative(process.cwd(), projectRoot);
  if (isAbsolute(requestedPath) && projectRoot !== resolve(requestedPath)) throw new Error('Widget project path is invalid.');
  if (relativeRoot.split(sep).includes('..') && requestedPath !== projectRoot) {
    throw new Error('Widget project path must not escape through traversal.');
  }
  const root = await lstat(projectRoot);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Widget project root must be a real directory.');
  const internalRoot = join(projectRoot, INTERNAL_DIRECTORY);
  await mkdir(internalRoot, { recursive: true, mode: 0o700 });
  await recoverInterruptedPromotion(projectRoot, internalRoot);
  const releaseLock = await acquireBuildLock(internalRoot);
  const operationId = randomUUID();
  const stageRoot = join(internalRoot, `build-stage-${operationId}`);
  try {
    const capture = await captureProject(projectRoot);
    const sourceDigestSha256 = fnWidgetPortableSourceDigest({ files: capture.sourceFiles, digestSha256: sha256 });
    const manifestDigestSha256 = fnWidgetManifestV1Digest({ manifest: capture.manifest, digestSha256: sha256 });
    const executableInputDigestSha256 = fnWidgetPortableExecutableInputDigest({
      manifest: capture.manifest,
      files: capture.sourceFiles,
      digestSha256: sha256,
    });
    await mkdir(stageRoot, { recursive: false, mode: 0o700 });
    await materialize([
      ...capture.sourceFiles,
      Object.freeze({ path: MANIFEST_PATH, bytes: new TextEncoder().encode(JSON.stringify(capture.manifest)) }),
    ], stageRoot);
    const stageInternal = join(stageRoot, INTERNAL_DIRECTORY);
    await mkdir(stageInternal, { recursive: true, mode: 0o700 });
    await writeFile(
      join(stageInternal, 'build-manifest.json'),
      fnCanonicalizeWidgetExecutableProjection(fnProjectWidgetExecutableManifest(capture.manifest)),
      { flag: 'wx', mode: 0o600 },
    );
    const configPath = join(stageInternal, 'portable.vite.config.mjs');
    await writeFile(configPath, fnWidgetPortableViteConfigSource(), { flag: 'wx', mode: 0o600 });
    const entryPath = join(stageRoot, ...capture.manifest.ui.entry.split('/'));
    const entrySource = await readFile(entryPath, 'utf8');
    const bootstrapSpecifier = relative(dirname(entryPath), join(stageRoot, GUEST_BRIDGE_PATH)).split(sep).join('/');
    await writeFile(
      entryPath,
      fnBootstrapWidgetUiEntry(entrySource, bootstrapSpecifier.startsWith('.') ? bootstrapSpecifier : `./${bootstrapSpecifier}`),
      { mode: 0o600 },
    );
    await writeFile(join(stageRoot, GUEST_BRIDGE_PATH), fnWidgetGuestBridgeBootstrapSource(), { flag: 'wx', mode: 0o600 });
    await runVite(projectRoot, stageRoot, configPath);
    const stagedDist = join(stageRoot, 'dist');
    const outputs = await outputFiles(stagedDist);
    if (!outputs.some((output) => output.path === 'dist/main.js')) throw new Error('Portable build did not produce dist/main.js.');
    const receipt = fnCreateWidgetBuildReceipt({
      sourceDigestSha256,
      manifestDigestSha256,
      executableInputDigestSha256,
      sdkVersion: SDK_VERSION,
      outputs,
      digestSha256: sha256,
    });
    for (const output of outputs) {
      const handle = await open(output.hostPath, constants.O_RDONLY);
      try { await handle.sync(); } finally { await handle.close(); }
    }
    const receiptPath = join(stageRoot, ...WIDGET_BUILD_RECEIPT_PATH.split('/'));
    const receiptTemp = `${receiptPath}.tmp`;
    await writeFile(receiptTemp, `${fnCanonicalizeWidgetBuildReceipt(receipt)}\n`, { flag: 'wx', mode: 0o600 });
    const receiptHandle = await open(receiptTemp, constants.O_RDONLY);
    try { await receiptHandle.sync(); } finally { await receiptHandle.close(); }
    await rename(receiptTemp, receiptPath);
    await syncDirectory(stagedDist);
    await promoteDist(projectRoot, internalRoot, stagedDist, operationId);
    process.stdout.write(`Widget build ${receipt.buildIdentity} completed.\n`);
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
    await releaseLock();
  }
}

function usage() {
  return [
    'Usage:',
    '  omnidraw-widget build [path]',
    '  omnidraw-widget check [path] [--json]',
    '',
  ].join('\n');
}

async function main(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(usage());
    return 0;
  }
  const [command, ...args] = argv;
  if (command === 'build') {
    if (args.length > 1 || args.some((arg) => arg.startsWith('-'))) {
      throw Object.assign(new Error('build accepts zero or one project path.'), { code: 'CLI_INVALID' });
    }
    await buildWidget(args[0] ?? '.');
    return 0;
  }
  if (command === 'check') {
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once('SIGINT', abort);
    process.once('SIGTERM', abort);
    try {
      return await checkWidget(args, controller.signal);
    } finally {
      process.removeListener('SIGINT', abort);
      process.removeListener('SIGTERM', abort);
    }
  }
  throw Object.assign(new Error(`Unknown command '${command}'.`), { code: 'CLI_INVALID' });
}

runSdkAsync(() => main(process.argv.slice(2))).then(
  (code) => { process.exitCode = code; },
  (error) => {
    const code = typeof error?.code === 'string' ? `${error.code}: ` : '';
    process.stderr.write(`${code}${sanitizeDiagnosticText(
      error instanceof Error ? error.message : 'Portable widget command failed.',
      process.cwd(),
    )}\n`);
    process.exitCode = error?.code === 'BUILD_BUSY' ? 4 : error?.code === 'CLI_INVALID' ? 2 : 1;
  },
);
