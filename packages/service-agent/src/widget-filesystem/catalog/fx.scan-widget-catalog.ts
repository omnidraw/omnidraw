import type {
  TWidgetManifestV1,
  TWidgetReleaseDescriptor,
  TWidgetReleaseFile,
  TWidgetReleaseValidation,
} from '@omnidraw/widget-contract/filesystem';
import type {
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetServerFunctionDescriptor,
} from '@omnidraw/widget-contract';
import {
  WIDGET_CATALOG_CAPSULE_PATH,
  WIDGET_CATALOG_DRAFT_EXCLUDED_DIRECTORIES,
  WIDGET_CATALOG_FUNCTIONS_PATH,
  WIDGET_CATALOG_LAYOUT_DIRECTORIES,
  WIDGET_CATALOG_MANIFEST_MAX_BYTES,
  WIDGET_CATALOG_MANIFEST_PATH,
  WIDGET_CATALOG_RELEASE_PATH,
  WIDGET_CATALOG_TEXT_FILE_MAX_BYTES,
} from './CONSTANTS';
import {
  fnCanonicalizeWidgetCatalogSnapshot,
  fnFreezeWidgetCatalogSnapshot,
  fnIsStrictWidgetCatalogSlug,
  fnResolveWidgetCatalogScanLimits,
  fnSortWidgetCatalogIssues,
  fnWidgetCatalogEntry,
  fnWidgetCatalogIssue,
} from './fn.catalog';
import type {
  TPinnedWidgetCatalogRoot,
  TWidgetCatalogDirectoryObservation,
  TWidgetCatalogDraft,
  TWidgetCatalogEntry,
  TWidgetCatalogFileObservation,
  TWidgetCatalogForm,
  TWidgetCatalogIssue,
  TWidgetCatalogPublished,
  TWidgetCatalogScanLimits,
  TWidgetCatalogScanPortal,
  TWidgetCatalogSnapshot,
} from './typed';
import { fnCanonicalizeWidgetObservedFileSet } from '../core/fn.file-set';

export type TPortal = TWidgetCatalogScanPortal;

export type TArgs = Readonly<{
  root: TPinnedWidgetCatalogRoot;
  generation: number;
  limits?: Partial<TWidgetCatalogScanLimits>;
}>;

export type TArgsPublishedFolder = Readonly<{
  root: TPinnedWidgetCatalogRoot;
  slug: string;
  relativePath: string;
  limits?: Partial<TWidgetCatalogScanLimits>;
}>;

type TScannedTree = Readonly<{
  files: readonly TWidgetCatalogFileObservation[];
  selectedBytes: ReadonlyMap<string, Uint8Array>;
  treeDigestSha256: string;
  issues: readonly TWidgetCatalogIssue[];
}>;

type TManifestFacts = Readonly<{
  manifest: TWidgetManifestV1 | null;
  manifestDigestSha256: string | null;
  presentation: ReturnType<TPortal['contracts']['projectPresentation']> | null;
  presentationDigestSha256: string | null;
  executable: ReturnType<TPortal['contracts']['projectExecutable']> | null;
  executableManifestDigestSha256: string | null;
}>;

type TScannedForm = Readonly<{
  forms: Readonly<Record<string, TWidgetCatalogDraft | TWidgetCatalogPublished>>;
  observation: TWidgetCatalogDirectoryObservation;
  issues: readonly TWidgetCatalogIssue[];
}>;

type TScanBudget = {
  widgetForms: number;
  entries: number;
  directories: number;
  files: number;
  bytes: number;
  exhausted: boolean;
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : 'Unknown widget catalog filesystem error.';
}

function errorCode(error: unknown): string | null {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

function issueForReadFailure(
  scope: TWidgetCatalogForm,
  relativePath: string,
  error: unknown,
): TWidgetCatalogIssue {
  const code = errorCode(error);
  return fnWidgetCatalogIssue({
    scope,
    code: code === 'WIDGET_CATALOG_DIRECTORY_LIMIT'
      ? 'scan_file_count_exceeded'
      : code?.endsWith('_CHANGED')
        ? 'filesystem_changed'
        : 'filesystem_read_failed',
    message: errorMessage(error),
    path: relativePath,
  });
}

function selectedText(
  portal: TPortal,
  tree: TScannedTree,
  path: string,
): string | null {
  const bytes = tree.selectedBytes.get(path);
  if (bytes === undefined || bytes.byteLength > WIDGET_CATALOG_TEXT_FILE_MAX_BYTES) return null;
  return portal.filesystem.decodeUtf8({ bytes });
}

function digestText(portal: TPortal, value: string): string {
  return digestValue(portal, value);
}

function digestValue(portal: TPortal, value: string | Uint8Array): string {
  const digest = portal.hash.digestSha256({ value });
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new TypeError('Widget catalog hash portal returned an invalid SHA-256 digest.');
  }
  return digest;
}

function manifestFacts(
  portal: TPortal,
  args: Readonly<{
    form: TWidgetCatalogForm;
    slug: string;
    tree: TScannedTree;
    issues: TWidgetCatalogIssue[];
  }>,
): TManifestFacts {
  const bytes = args.tree.selectedBytes.get(WIDGET_CATALOG_MANIFEST_PATH);
  if (bytes === undefined) {
    args.issues.push(fnWidgetCatalogIssue({
      scope: args.form,
      code: 'manifest_missing',
      message: 'Widget folder is missing omnidraw.json.',
      path: `${args.form === 'draft' ? 'drafts' : 'published'}/${args.slug}`,
    }));
    return {
      manifest: null,
      manifestDigestSha256: null,
      presentation: null,
      presentationDigestSha256: null,
      executable: null,
      executableManifestDigestSha256: null,
    };
  }
  if (bytes.byteLength > WIDGET_CATALOG_MANIFEST_MAX_BYTES) {
    args.issues.push(fnWidgetCatalogIssue({
      scope: args.form,
      code: 'manifest_invalid',
      message: 'Invalid omnidraw.json: manifest exceeds the 128 KiB limit.',
      path: `${args.form === 'draft' ? 'drafts' : 'published'}/${args.slug}/omnidraw.json`,
    }));
    return {
      manifest: null,
      manifestDigestSha256: null,
      presentation: null,
      presentationDigestSha256: null,
      executable: null,
      executableManifestDigestSha256: null,
    };
  }
  try {
    const text = portal.filesystem.decodeUtf8({ bytes });
    const manifest = portal.contracts.parseManifestJson(text);
    if (manifest.slug !== args.slug) {
      args.issues.push(fnWidgetCatalogIssue({
        scope: args.form,
        code: 'manifest_slug_mismatch',
        message: `Folder slug '${args.slug}' does not match manifest slug '${manifest.slug}'.`,
        path: `${args.form === 'draft' ? 'drafts' : 'published'}/${args.slug}/omnidraw.json`,
      }));
    }
    const digestSha256 = (value: string) => digestText(portal, value);
    return {
      manifest,
      manifestDigestSha256: portal.contracts.manifestDigest({ manifest, digestSha256 }),
      presentation: portal.contracts.projectPresentation(manifest),
      presentationDigestSha256: digestSha256(
        portal.contracts.canonicalizePresentation(manifest),
      ),
      executable: portal.contracts.projectExecutable(manifest),
      executableManifestDigestSha256: portal.contracts.executableManifestDigest({
        manifest,
        digestSha256,
      }),
    };
  } catch (error) {
    args.issues.push(fnWidgetCatalogIssue({
      scope: args.form,
      code: 'manifest_invalid',
      message: `Invalid omnidraw.json: ${errorMessage(error)}`,
      path: `${args.form === 'draft' ? 'drafts' : 'published'}/${args.slug}/omnidraw.json`,
    }));
    return {
      manifest: null,
      manifestDigestSha256: null,
      presentation: null,
      presentationDigestSha256: null,
      executable: null,
      executableManifestDigestSha256: null,
    };
  }
}

async function scanTree(
  portal: TPortal,
  args: Readonly<{
    root: TPinnedWidgetCatalogRoot;
    form: TWidgetCatalogForm;
    slug: string;
    limits: TWidgetCatalogScanLimits;
    budget: TScanBudget;
    widgetRoot?: string;
  }>,
): Promise<TScannedTree> {
  const formDirectory = args.form === 'draft' ? 'drafts' : 'published';
  const widgetRoot = args.widgetRoot ?? `${formDirectory}/${args.slug}`;
  const maxFiles = args.form === 'draft'
    ? args.limits.draftMaxFiles
    : args.limits.publishedMaxFiles;
  const maxFileBytes = args.form === 'draft'
    ? args.limits.draftMaxFileBytes
    : args.limits.publishedMaxFileBytes;
  const maxTotalBytes = args.form === 'draft'
    ? args.limits.draftMaxTotalBytes
    : args.limits.publishedMaxTotalBytes;
  const files: TWidgetCatalogFileObservation[] = [];
  const selectedBytes = new Map<string, Uint8Array>();
  const issues: TWidgetCatalogIssue[] = [];
  const observations: TWidgetCatalogDirectoryObservation[] = [];
  const queue: Array<Readonly<{ relativePath: string; widgetPath: string; depth: number }>> = [{
    relativePath: widgetRoot,
    widgetPath: '',
    depth: 0,
  }];
  const foldedPaths = new Map<string, string>();
  let totalBytes = 0;
  let directories = 0;
  let entriesScanned = 0;
  let stopped = false;

  while (queue.length > 0 && !stopped) {
    const directory = queue.shift()!;
    if (args.budget.directories >= args.limits.maxGlobalDirectories) {
      issues.push(fnWidgetCatalogIssue({
        scope: args.form,
        code: 'scan_global_directory_count_exceeded',
        message: 'Widget catalog reached its global directory scan limit.',
        path: directory.relativePath,
      }));
      args.budget.exhausted = true;
      break;
    }
    args.budget.directories += 1;
    directories += 1;
    if (directories > args.limits.maxDirectoriesPerWidget) {
      issues.push(fnWidgetCatalogIssue({
        scope: args.form,
        code: 'scan_directory_count_exceeded',
        message: 'Widget directory count exceeds the catalog scan limit.',
        path: directory.relativePath,
      }));
      break;
    }
    let observation: TWidgetCatalogDirectoryObservation;
    try {
      observation = await portal.filesystem.readDirectory(args.root, {
        relativePath: directory.relativePath,
        maxEntries: args.limits.maxEntriesPerDirectory,
      });
      observations.push(observation);
    } catch (error) {
      issues.push(issueForReadFailure(args.form, directory.relativePath, error));
      break;
    }

    for (const entry of [...observation.entries].sort((left, right) => (
      compareText(left.name, right.name)
    ))) {
      if (entriesScanned >= args.limits.maxEntriesPerWidget) {
        issues.push(fnWidgetCatalogIssue({
          scope: args.form,
          code: 'scan_entry_count_exceeded',
          message: 'Widget tree exceeds its entry scan limit.',
          path: directory.relativePath,
        }));
        stopped = true;
        break;
      }
      if (args.budget.entries >= args.limits.maxGlobalEntries) {
        issues.push(fnWidgetCatalogIssue({
          scope: args.form,
          code: 'scan_global_entry_count_exceeded',
          message: 'Widget catalog reached its global entry scan limit.',
          path: directory.relativePath,
        }));
        args.budget.exhausted = true;
        stopped = true;
        break;
      }
      entriesScanned += 1;
      args.budget.entries += 1;
      const widgetPath = directory.widgetPath === ''
        ? entry.name
        : `${directory.widgetPath}/${entry.name}`;
      const normalized = portal.contracts.normalizeRelativePath(widgetPath);
      if (normalized === null || normalized !== widgetPath) {
        issues.push(fnWidgetCatalogIssue({
          scope: args.form,
          code: 'unsafe_path',
          message: `Unsafe widget path '${widgetPath}'.`,
          path: `${widgetRoot}/${widgetPath}`,
        }));
        continue;
      }
      const folded = normalized.toLowerCase();
      const prior = foldedPaths.get(folded);
      if (prior !== undefined && prior !== normalized) {
        issues.push(fnWidgetCatalogIssue({
          scope: args.form,
          code: 'path_case_collision',
          message: `Widget paths '${prior}' and '${normalized}' collide by case.`,
          path: `${widgetRoot}/${normalized}`,
        }));
        continue;
      }
      foldedPaths.set(folded, normalized);

      if (entry.kind === 'symlink') {
        issues.push(fnWidgetCatalogIssue({
          scope: args.form,
          code: 'symlink_not_allowed',
          message: `Widget symlink '${widgetPath}' is not allowed.`,
          path: `${widgetRoot}/${widgetPath}`,
        }));
        continue;
      }
      if (entry.kind === 'special') {
        issues.push(fnWidgetCatalogIssue({
          scope: args.form,
          code: 'special_file_not_allowed',
          message: `Widget special file '${widgetPath}' is not allowed.`,
          path: `${widgetRoot}/${widgetPath}`,
        }));
        continue;
      }
      if (entry.kind === 'directory') {
        if (
          args.form === 'draft'
          && directory.depth === 0
          && WIDGET_CATALOG_DRAFT_EXCLUDED_DIRECTORIES.has(entry.name)
        ) continue;
        if (directory.depth + 1 > args.limits.maxDepth) {
          issues.push(fnWidgetCatalogIssue({
            scope: args.form,
            code: 'scan_depth_exceeded',
            message: `Widget path '${widgetPath}' exceeds the scan depth limit.`,
            path: `${widgetRoot}/${widgetPath}`,
          }));
          continue;
        }
        queue.push({
          relativePath: `${widgetRoot}/${normalized}`,
          widgetPath: normalized,
          depth: directory.depth + 1,
        });
        continue;
      }

      if (files.length >= maxFiles) {
        issues.push(fnWidgetCatalogIssue({
          scope: args.form,
          code: 'scan_file_count_exceeded',
          message: `Widget file count exceeds the ${maxFiles}-file scan limit.`,
          path: `${widgetRoot}/${normalized}`,
        }));
        stopped = true;
        break;
      }
      const observedSize = entry.byteSize ?? 0;
      if (args.budget.files >= args.limits.maxGlobalFiles) {
        issues.push(fnWidgetCatalogIssue({
          scope: args.form,
          code: 'scan_global_file_count_exceeded',
          message: 'Widget catalog reached its global file observation limit.',
          path: `${widgetRoot}/${normalized}`,
        }));
        args.budget.exhausted = true;
        stopped = true;
        break;
      }
      if (observedSize > maxFileBytes) {
        issues.push(fnWidgetCatalogIssue({
          scope: args.form,
          code: 'scan_file_size_exceeded',
          message: `Widget file '${normalized}' exceeds the per-file scan limit.`,
          path: `${widgetRoot}/${normalized}`,
        }));
        continue;
      }
      if (totalBytes + observedSize > maxTotalBytes) {
        issues.push(fnWidgetCatalogIssue({
          scope: args.form,
          code: 'scan_total_size_exceeded',
          message: 'Widget files exceed the total catalog scan byte limit.',
          path: `${widgetRoot}/${normalized}`,
        }));
        stopped = true;
        break;
      }
      if (args.budget.bytes + observedSize > args.limits.maxGlobalTotalBytes) {
        issues.push(fnWidgetCatalogIssue({
          scope: args.form,
          code: 'scan_global_total_size_exceeded',
          message: 'Widget catalog reached its global byte-read limit.',
          path: `${widgetRoot}/${normalized}`,
        }));
        args.budget.exhausted = true;
        stopped = true;
        break;
      }
      try {
        const bytes = await portal.filesystem.readFile(args.root, {
          relativePath: `${widgetRoot}/${normalized}`,
          maxBytes: maxFileBytes,
        });
        if (bytes.byteLength !== observedSize) {
          throw Object.assign(new Error(`Widget file '${normalized}' changed size during scan.`), {
            code: 'WIDGET_CATALOG_FILE_CHANGED',
          });
        }
        totalBytes += bytes.byteLength;
        args.budget.files += 1;
        args.budget.bytes += bytes.byteLength;
        files.push(Object.freeze({
          path: normalized,
          byteSize: bytes.byteLength,
          sha256: digestValue(portal, bytes),
        }));
        if (
          normalized === WIDGET_CATALOG_MANIFEST_PATH
          || normalized === WIDGET_CATALOG_RELEASE_PATH
          || normalized === WIDGET_CATALOG_CAPSULE_PATH
          || normalized === WIDGET_CATALOG_FUNCTIONS_PATH
        ) selectedBytes.set(normalized, bytes);
      } catch (error) {
        issues.push(issueForReadFailure(args.form, `${widgetRoot}/${normalized}`, error));
      }
    }
  }

  for (const observation of observations.reverse()) {
    try {
      await portal.filesystem.assertDirectoryUnchanged(args.root, {
        observation,
        maxEntries: args.limits.maxEntriesPerDirectory,
      });
    } catch (error) {
      issues.push(issueForReadFailure(args.form, observation.relativePath, error));
    }
  }
  const orderedFiles = files.sort((left, right) => compareText(left.path, right.path));
  return Object.freeze({
    files: Object.freeze(orderedFiles),
    selectedBytes,
    treeDigestSha256: digestValue(
      portal,
      fnCanonicalizeWidgetObservedFileSet(orderedFiles),
    ),
    issues: fnSortWidgetCatalogIssues(issues),
  });
}

async function scanDraft(
  portal: TPortal,
  args: Readonly<{
    root: TPinnedWidgetCatalogRoot;
    slug: string;
    limits: TWidgetCatalogScanLimits;
    budget: TScanBudget;
    initialIssues?: readonly TWidgetCatalogIssue[];
  }>,
): Promise<TWidgetCatalogDraft> {
  const tree = args.initialIssues === undefined
    ? await scanTree(portal, {
        root: args.root,
        form: 'draft',
        slug: args.slug,
        limits: args.limits,
        budget: args.budget,
      })
    : Object.freeze({
        files: Object.freeze([]),
        selectedBytes: new Map<string, Uint8Array>(),
        treeDigestSha256: digestValue(portal, '[]'),
        issues: args.initialIssues,
      });
  const issues = [...tree.issues];
  const facts = manifestFacts(portal, { form: 'draft', slug: args.slug, tree, issues });
  const orderedIssues = fnSortWidgetCatalogIssues(issues);
  return Object.freeze({
    kind: 'draft',
    slug: args.slug,
    relativePath: `drafts/${args.slug}`,
    health: orderedIssues.length === 0 ? 'healthy' : 'unhealthy',
    ...facts,
    treeDigestSha256: tree.treeDigestSha256,
    files: tree.files,
    issues: orderedIssues,
  });
}

async function scanPublished(
  portal: TPortal,
  args: Readonly<{
    root: TPinnedWidgetCatalogRoot;
    slug: string;
    limits: TWidgetCatalogScanLimits;
    budget: TScanBudget;
    initialIssues?: readonly TWidgetCatalogIssue[];
    relativePath?: string;
  }>,
): Promise<TWidgetCatalogPublished> {
  const tree = args.initialIssues === undefined
    ? await scanTree(portal, {
        root: args.root,
        form: 'published',
        slug: args.slug,
        limits: args.limits,
        budget: args.budget,
        ...(args.relativePath === undefined ? {} : { widgetRoot: args.relativePath }),
      })
    : Object.freeze({
        files: Object.freeze([]),
        selectedBytes: new Map<string, Uint8Array>(),
        treeDigestSha256: digestValue(portal, '[]'),
        issues: args.initialIssues,
      });
  const issues = [...tree.issues];
  const facts = manifestFacts(portal, { form: 'published', slug: args.slug, tree, issues });
  let release: TWidgetReleaseDescriptor | null = null;
  let releaseDescriptorDigestSha256: string | null = null;
  let releaseValidation: TWidgetReleaseValidation | null = null;
  let capsuleRuntime: TWidgetCapsuleRuntimeDescriptor | null = null;
  let functions: readonly TWidgetServerFunctionDescriptor[] | null = null;
  const releaseBytes = tree.selectedBytes.get(WIDGET_CATALOG_RELEASE_PATH);
  if (releaseBytes === undefined) {
    issues.push(fnWidgetCatalogIssue({
      scope: 'published',
      code: 'release_missing',
      message: 'Published widget is missing release.json completion marker.',
      path: `published/${args.slug}`,
    }));
  } else {
    releaseDescriptorDigestSha256 = digestValue(portal, releaseBytes);
    try {
      const text = selectedText(portal, tree, WIDGET_CATALOG_RELEASE_PATH);
      if (text === null) throw new TypeError('release.json exceeds the catalog text limit.');
      release = portal.contracts.parseReleaseJson(text);
    } catch (error) {
      issues.push(fnWidgetCatalogIssue({
        scope: 'published',
        code: 'release_invalid',
        message: `Invalid release.json: ${errorMessage(error)}`,
        path: `published/${args.slug}/release.json`,
      }));
    }
  }

  const capsuleBytes = tree.selectedBytes.get(WIDGET_CATALOG_CAPSULE_PATH);
  let inspectedCapsule: Awaited<ReturnType<TPortal['capsule']['inspectCapsuleArtifact']>> | null = null;
  if (facts.manifest !== null && capsuleBytes !== undefined && release !== null) {
    try {
      inspectedCapsule = await portal.capsule.inspectCapsuleArtifact({
        bytes: capsuleBytes,
        expectedApis: facts.manifest.ui.apis,
        expectedRuntime: release.capsule.runtime,
        expectedCapsuleFile: release.files.find(
          (file) => file.path === release.capsule.path,
        ) ?? (() => { throw new TypeError('Attested release does not list capsule.artifact.'); })(),
        canonicalUnsignedReleaseJson: portal.contracts.canonicalizeUnsignedRelease(release),
        releaseAttestation: release.releaseAttestation,
      });
      capsuleRuntime = inspectedCapsule.runtime;
    } catch (error) {
      issues.push(fnWidgetCatalogIssue({
        scope: 'published',
        code: 'capsule_inspection_failed',
        message: `Capsule inspection failed: ${errorMessage(error)}`,
        path: `published/${args.slug}/capsule.artifact`,
      }));
    }
  } else if (facts.manifest !== null && capsuleBytes === undefined) {
    issues.push(fnWidgetCatalogIssue({
      scope: 'published',
      code: 'capsule_inspection_failed',
      message: 'Published widget is missing capsule.artifact.',
      path: `published/${args.slug}/capsule.artifact`,
    }));
  } else if (facts.manifest !== null && release === null) {
    issues.push(fnWidgetCatalogIssue({
      scope: 'published',
      code: 'capsule_inspection_failed',
      message: 'Capsule inspection requires a valid attested release descriptor.',
      path: `published/${args.slug}/release.json`,
    }));
  }

  let serverObservation: {
    serverDistDigestSha256: string;
    functionsDigestSha256: string;
    functions: readonly TWidgetServerFunctionDescriptor[];
  } | null = null;
  if (facts.manifest?.server !== undefined) {
    const functionsFile = tree.files.find((file) => file.path === WIDGET_CATALOG_FUNCTIONS_PATH);
    try {
      const text = selectedText(portal, tree, WIDGET_CATALOG_FUNCTIONS_PATH);
      if (text === null || functionsFile === undefined) {
        throw new TypeError('Published server widget is missing a bounded functions.json.');
      }
      functions = portal.contracts.parseFunctionsJson(text);
      const serverFiles: TWidgetReleaseFile[] = tree.files
        .filter((file) => file.path.startsWith('server-dist/'))
        .map((file) => ({ ...file, path: file.path.slice('server-dist/'.length) }));
      serverObservation = {
        serverDistDigestSha256: portal.contracts.releaseDirectoryDigest({
          files: serverFiles,
          digestSha256: (value) => digestText(portal, value),
        }),
        functionsDigestSha256: functionsFile.sha256,
        functions,
      };
    } catch (error) {
      issues.push(fnWidgetCatalogIssue({
        scope: 'published',
        code: 'functions_invalid',
        message: `Invalid server output: ${errorMessage(error)}`,
        path: `published/${args.slug}/functions.json`,
      }));
    }
  }

  if (
    facts.manifest !== null
    && facts.executableManifestDigestSha256 !== null
    && release !== null
    && inspectedCapsule !== null
  ) {
    const runtimeFiles = tree.files.filter((file) => (
      file.path !== WIDGET_CATALOG_MANIFEST_PATH
      && file.path !== WIDGET_CATALOG_RELEASE_PATH
    ));
    releaseValidation = portal.contracts.validateRelease({
      manifest: facts.manifest,
      expectedExecutableManifestDigestSha256: facts.executableManifestDigestSha256,
      release,
      observation: {
        files: runtimeFiles,
        capsule: {
          artifactHash: inspectedCapsule.artifactHash,
          runtime: inspectedCapsule.runtime,
        },
        server: serverObservation,
      },
    });
    if (!releaseValidation.valid) {
      issues.push(fnWidgetCatalogIssue({
        scope: 'published',
        code: 'release_validation_failed',
        message: `Published release validation failed: ${releaseValidation.reason}.`,
        path: releaseValidation.path === undefined
          ? `published/${args.slug}`
          : `published/${args.slug}/${releaseValidation.path}`,
      }));
    }
  }

  const orderedIssues = fnSortWidgetCatalogIssues(issues);
  return Object.freeze({
    kind: 'published',
    slug: args.slug,
    relativePath: args.relativePath ?? `published/${args.slug}`,
    health: orderedIssues.length === 0 && releaseValidation?.valid === true
      ? 'healthy'
      : 'unhealthy',
    ...facts,
    treeDigestSha256: tree.treeDigestSha256,
    files: tree.files,
    release,
    releaseDescriptorDigestSha256,
    releaseValidation,
    capsuleRuntime,
    functions,
    issues: orderedIssues,
  });
}

/** Validates one already-materialized publication folder, including staging paths. */
export async function fxScanWidgetPublishedFolder(
  portal: TPortal,
  args: TArgsPublishedFolder,
): Promise<TWidgetCatalogPublished> {
  const limits = fnResolveWidgetCatalogScanLimits(args.limits);
  const budget: TScanBudget = {
    widgetForms: 1,
    entries: 0,
    directories: 0,
    files: 0,
    bytes: 0,
    exhausted: false,
  };
  return scanPublished(portal, {
    root: args.root,
    slug: args.slug,
    relativePath: args.relativePath,
    limits,
    budget,
  });
}

async function scanForm(
  portal: TPortal,
  args: Readonly<{
    root: TPinnedWidgetCatalogRoot;
    form: TWidgetCatalogForm;
    limits: TWidgetCatalogScanLimits;
    layoutObservation: TWidgetCatalogDirectoryObservation;
    budget: TScanBudget;
  }>,
): Promise<TScannedForm | null> {
  const formDirectory = args.form === 'draft' ? 'drafts' : 'published';
  const formEntry = args.layoutObservation.entries.find((entry) => entry.name === formDirectory);
  if (formEntry?.kind !== 'directory') return null;
  const observation = await portal.filesystem.readDirectory(args.root, {
    relativePath: formDirectory,
    maxEntries: args.limits.maxEntriesPerDirectory,
  });
  const formIssues: TWidgetCatalogIssue[] = [];
  const groups = new Map<string, typeof observation.entries>();
  for (const entry of observation.entries) {
    if (!fnIsStrictWidgetCatalogSlug(entry.name)) {
      formIssues.push(fnWidgetCatalogIssue({
        scope: args.form,
        code: 'unsafe_slug',
        message: `Unsafe widget folder slug '${entry.name}'.`,
        path: `${formDirectory}/${entry.name}`,
      }));
    }
    const folded = entry.name.toLowerCase();
    groups.set(folded, Object.freeze([...(groups.get(folded) ?? []), entry]));
  }
  const forms: Record<string, TWidgetCatalogDraft | TWidgetCatalogPublished> = {};
  for (const group of [...groups.values()].sort((left, right) => (
    compareText(left[0]!.name.toLowerCase(), right[0]!.name.toLowerCase())
  ))) {
    const exactSlug = group.find((entry) => fnIsStrictWidgetCatalogSlug(entry.name));
    if (exactSlug === undefined) continue;
    if (args.budget.widgetForms >= args.limits.maxWidgetForms || args.budget.exhausted) {
      formIssues.push(fnWidgetCatalogIssue({
        scope: args.form,
        code: 'scan_widget_count_exceeded',
        message: 'Widget catalog reached its global widget-form scan budget.',
        path: formDirectory,
      }));
      args.budget.exhausted = true;
      break;
    }
    args.budget.widgetForms += 1;
    const slug = exactSlug.name;
    let initialIssues: readonly TWidgetCatalogIssue[] | undefined;
    if (group.length > 1) {
      initialIssues = [fnWidgetCatalogIssue({
        scope: args.form,
        code: 'slug_case_collision',
        message: `Widget folders ${group.map((entry) => `'${entry.name}'`).join(', ')} collide by case.`,
        path: `${formDirectory}/${slug}`,
      })];
    } else if (exactSlug.kind !== 'directory') {
      initialIssues = [fnWidgetCatalogIssue({
        scope: args.form,
        code: exactSlug.kind === 'symlink'
          ? 'symlink_not_allowed'
          : exactSlug.kind === 'special'
            ? 'special_file_not_allowed'
            : 'widget_entry_not_directory',
        message: `Widget entry '${formDirectory}/${slug}' must be a real directory.`,
        path: `${formDirectory}/${slug}`,
      })];
    }
    forms[slug] = args.form === 'draft'
      ? await scanDraft(portal, {
          root: args.root,
          slug,
          limits: args.limits,
          budget: args.budget,
          initialIssues,
        })
      : await scanPublished(portal, {
          root: args.root,
          slug,
          limits: args.limits,
          budget: args.budget,
          initialIssues,
        });
  }
  await portal.filesystem.assertDirectoryUnchanged(args.root, {
    observation,
    maxEntries: args.limits.maxEntriesPerDirectory,
  });
  return Object.freeze({
    forms: Object.freeze(forms),
    observation,
    issues: fnSortWidgetCatalogIssues(formIssues),
  });
}

function rootLayoutIssues(
  observation: TWidgetCatalogDirectoryObservation,
): readonly TWidgetCatalogIssue[] {
  const issues: TWidgetCatalogIssue[] = [];
  const groups = new Map<string, typeof observation.entries>();
  for (const entry of observation.entries) {
    const folded = entry.name.toLowerCase();
    groups.set(folded, Object.freeze([...(groups.get(folded) ?? []), entry]));
  }
  for (const required of ['drafts', 'published'] as const) {
    const group = groups.get(required) ?? [];
    if (group.length === 0) {
      issues.push(fnWidgetCatalogIssue({
        scope: 'root',
        code: 'layout_missing',
        message: `Widget root is missing '${required}/'.`,
        path: required,
      }));
    } else if (group.length > 1) {
      issues.push(fnWidgetCatalogIssue({
        scope: 'root',
        code: 'layout_case_collision',
        message: `Widget root entries ${group.map((entry) => `'${entry.name}'`).join(', ')} collide by case.`,
        path: required,
      }));
    } else if (group[0]!.name !== required || group[0]!.kind !== 'directory') {
      issues.push(fnWidgetCatalogIssue({
        scope: 'root',
        code: 'layout_entry_invalid',
        message: `Widget root entry '${required}' must be a real, exactly-cased directory.`,
        path: required,
      }));
    }
  }
  const known = new Set<string>([...WIDGET_CATALOG_LAYOUT_DIRECTORIES, '.writer.lock']);
  for (const entry of observation.entries) {
    if (!known.has(entry.name)) {
      issues.push(fnWidgetCatalogIssue({
        scope: 'root',
        code: 'unexpected_layout_entry',
        message: `Unexpected widget-root entry '${entry.name}'.`,
        path: entry.name,
      }));
      continue;
    }
    if (entry.name === '.writer.lock') {
      if (entry.kind !== 'file') {
        issues.push(fnWidgetCatalogIssue({
          scope: 'root',
          code: 'layout_entry_invalid',
          message: "Widget-root '.writer.lock' must be a regular file when present.",
          path: entry.name,
        }));
      }
    } else if (entry.kind !== 'directory') {
      issues.push(fnWidgetCatalogIssue({
        scope: 'root',
        code: 'layout_entry_invalid',
        message: `Widget-root '${entry.name}' must be a real directory.`,
        path: entry.name,
      }));
    }
  }
  return fnSortWidgetCatalogIssues(issues);
}

export async function fxScanWidgetCatalog(
  portal: TPortal,
  args: TArgs,
): Promise<TWidgetCatalogSnapshot> {
  if (!Number.isSafeInteger(args.generation) || args.generation < 1) {
    throw new TypeError('Widget catalog generation must be a positive integer.');
  }
  const limits = fnResolveWidgetCatalogScanLimits(args.limits);
  await portal.filesystem.assertRoot(args.root, {});
  const layoutObservation = await portal.filesystem.readDirectory(args.root, {
    relativePath: '',
    maxEntries: limits.maxEntriesPerDirectory,
  });
  const issues = rootLayoutIssues(layoutObservation);
  const budget: TScanBudget = {
    widgetForms: 0,
    entries: 0,
    directories: 0,
    files: 0,
    bytes: 0,
    exhausted: false,
  };
  const blockingLayouts = new Set(issues
    .filter((issue) => issue.code === 'layout_missing'
      || issue.code === 'layout_entry_invalid'
      || issue.code === 'layout_case_collision')
    .map((issue) => issue.path));
  // Current executable publications are scanned before editable drafts so a
  // pathological draft set cannot spend the global budget before runtime lookup.
  const scannedPublished = blockingLayouts.has('published')
    ? null
    : await scanForm(portal, {
        root: args.root,
        form: 'published',
        limits,
        layoutObservation,
        budget,
      });
  const scannedDrafts = blockingLayouts.has('drafts')
    ? null
    : await scanForm(portal, {
        root: args.root,
        form: 'draft',
        limits,
        layoutObservation,
        budget,
      });

  const draftForms: Readonly<Record<string, TWidgetCatalogDraft | TWidgetCatalogPublished>> =
    scannedDrafts?.forms ?? Object.freeze({});
  const publishedForms: Readonly<Record<string, TWidgetCatalogDraft | TWidgetCatalogPublished>> =
    scannedPublished?.forms ?? Object.freeze({});

  const slugs = [...new Set([...Object.keys(draftForms), ...Object.keys(publishedForms)])]
    .sort(compareText);
  const entries: Record<string, TWidgetCatalogEntry> = {};
  for (const slug of slugs) {
    const draft = draftForms[slug];
    const published = publishedForms[slug];
    entries[slug] = fnWidgetCatalogEntry({
      slug,
      draft: draft?.kind === 'draft' ? draft : null,
      published: published?.kind === 'published' ? published : null,
    });
  }
  await portal.filesystem.assertDirectoryUnchanged(args.root, {
    observation: layoutObservation,
    maxEntries: limits.maxEntriesPerDirectory,
  });
  for (const scanned of [scannedDrafts, scannedPublished]) {
    if (scanned === null) continue;
    await portal.filesystem.assertDirectoryUnchanged(args.root, {
      observation: scanned.observation,
      maxEntries: limits.maxEntriesPerDirectory,
    });
  }
  await portal.filesystem.assertRoot(args.root, {});
  const orderedIssues = fnSortWidgetCatalogIssues([
    ...issues,
    ...(scannedDrafts?.issues ?? []),
    ...(scannedPublished?.issues ?? []),
  ]);
  const digestSha256 = digestValue(
    portal,
    fnCanonicalizeWidgetCatalogSnapshot({ entries, issues: orderedIssues }),
  );
  return fnFreezeWidgetCatalogSnapshot({
    format: 'omnidraw.widget-catalog.v1',
    generation: args.generation,
    digestSha256,
    rootIdentity: args.root.identity,
    healthy: orderedIssues.length === 0
      && Object.values(entries).every((entry) => entry.health === 'healthy'),
    entries,
    issues: orderedIssues,
  });
}
