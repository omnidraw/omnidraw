import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ZWidgetManifestV3, type TWidgetManifestV3 } from '@vibecanvas/widget-contract';
import type { WidgetDraftController } from '../widget-drafts/WidgetDraftController';
import type { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import {
  WIDGET_CATALOG_MAX_BYTES,
  WIDGET_CATALOG_MAX_FILES,
  WIDGET_FILE_READ_MAX_BYTES,
  WIDGET_FILE_TEXT_PREVIEW_MAX_BYTES,
  WIDGET_INSPECTION_MAX_FILES,
  WIDGET_PRIVATE_DIRECTORY_NAMES,
  WIDGET_PRIVATE_FILE_NAMES,
  WIDGET_TRANSIENT_PREFIXES,
} from './CONSTANTS';
import {
  fnIsSafeWidgetName,
  fnIsSafeWidgetRelativePath,
  fnSortWidgetEntries,
  fnWidgetProblem,
  fnWidgetVariantSummary,
} from './fn.widget-management';
import type {
  TWidgetCatalog,
  TWidgetCatalogEntry,
  TWidgetCatalogGroup,
  TWidgetCatalogProblem,
  TWidgetPlacementResolveResult,
  TWidgetDetail,
  TWidgetDeleteResult,
  TWidgetDraftMetadataPatch,
  TWidgetDraftMetadataPatchResult,
  TWidgetDraftToolPatch,
  TWidgetFileEntry,
  TWidgetFilePreview,
  TWidgetManagementManifest,
  TWidgetSource,
  TWidgetVariantSummary,
} from './types';

type TWidgetManagementConfig = {
  workspace: WidgetWorkspace;
  drafts: WidgetDraftController;
  afterVariantFingerprint?: (args: Readonly<{
    name: string;
    source: TWidgetSource;
    attempt: number;
  }>) => void | Promise<void>;
};

type TTreeFingerprint = {
  fingerprint: string | null;
  updatedAt: string | null;
  problem: TWidgetCatalogProblem | null;
};

type TVariantRead = {
  summary: TWidgetVariantSummary;
  manifest: TWidgetManagementManifest | null;
  problem: TWidgetCatalogProblem | null;
};

export class WidgetManagement {
  readonly #workspace: WidgetWorkspace;
  readonly #drafts: WidgetDraftController;
  readonly #afterVariantFingerprint?: TWidgetManagementConfig['afterVariantFingerprint'];

  constructor(config: TWidgetManagementConfig) {
    this.#workspace = config.workspace;
    this.#drafts = config.drafts;
    this.#afterVariantFingerprint = config.afterVariantFingerprint;
  }

  async catalog(groups: TWidgetCatalogGroup[]): Promise<TWidgetCatalog> {
    const draftNames = await this.#discoverNames(this.#workspace.draftRoot);
    const names = [...draftNames].sort((left, right) => left.localeCompare(right));
    const widgets = await Promise.all(names.map((name) => this.#catalogEntry(name, false, true)));
    const sortedGroups = [...groups].sort((left, right) => left.name.localeCompare(right.name));
    const sortedWidgets = fnSortWidgetEntries(widgets);
    const generation = createHash('sha256')
      .update(JSON.stringify({ groups: sortedGroups, widgets: sortedWidgets }))
      .digest('hex');
    return { generation, groups: sortedGroups, widgets: sortedWidgets };
  }

  async detail(name: string, source: TWidgetSource): Promise<TWidgetDetail | null> {
    this.#assertName(name);
    if (source === 'published' || !await this.#hasVariant(name, 'draft')) return null;
    const entry = await this.#catalogEntry(name, false, true);
    const selected = await this.#readVariant(name, source);
    const sibling = entry.published;
    return {
      name,
      source,
      relation: entry.relation,
      variant: selected.summary,
      sibling,
      manifest: selected.manifest,
      functions: [],
      problem: selected.problem ?? entry.problem,
    };
  }

  async resolvePlacementReference(reference: import('@vibecanvas/widget-contract').TWidgetPlacementRef): Promise<TWidgetPlacementResolveResult> {
    if (reference.source === 'published') {
      return { ok: false, code: 'NOT_FOUND', message: `Published widget '${reference.name}' is not available in draft storage.` };
    }
    const source: TWidgetSource = 'draft';
    const detail = await this.detail(reference.name, source);
    if (!detail) {
      return { ok: false, code: 'NOT_FOUND', message: `Widget ${reference.source} '${reference.name}' was not found.` };
    }
    if (detail.problem || !detail.manifest || !detail.variant.placement) {
      return { ok: false, code: 'INVALID_MANIFEST', message: detail.problem?.message ?? 'The widget manifest is invalid.' };
    }
    if (detail.variant.revision !== reference.revision) {
      return {
        ok: false,
        code: 'STALE_REVISION',
        message: `Widget ${reference.source} '${reference.name}' changed before placement.`,
        currentRevision: detail.variant.revision,
      };
    }
    return {
      ok: true,
      descriptor: {
        reference,
        bounds: detail.variant.placement.bounds,
        kind: 'preview',
        draftId: null,
        definitionId: null,
        revisionId: null,
        definitionName: null,
        definitionSlug: null,
      },
    };
  }

  async files(name: string, source: TWidgetSource): Promise<TWidgetFileEntry[] | null> {
    const root = await this.#variantRoot(name, source);
    if (!root) return null;
    const files: TWidgetFileEntry[] = [];
    const walk = async (absoluteDir: string, displayDir: string): Promise<void> => {
      const entries = await readdir(absoluteDir, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (this.#isPrivateEntry(entry.name, entry.isDirectory())) continue;
        if (entry.isSymbolicLink()) throw new Error('UNSAFE_PATH: Widget source contains a symbolic link.');
        const path = displayDir ? `${displayDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          files.push({ path, kind: 'directory', size: 0 });
          if (files.length > WIDGET_INSPECTION_MAX_FILES) throw new Error('PAYLOAD_LIMIT: Widget file tree exceeds the inspection limit.');
          await walk(join(absoluteDir, entry.name), path);
        } else if (entry.isFile()) {
          const details = await stat(join(absoluteDir, entry.name));
          files.push({ path, kind: 'file', size: details.size });
          if (files.length > WIDGET_INSPECTION_MAX_FILES) throw new Error('PAYLOAD_LIMIT: Widget file tree exceeds the inspection limit.');
        }
      }
    };
    await walk(root, '');
    return files;
  }

  async file(name: string, source: TWidgetSource, path: string): Promise<TWidgetFilePreview | null> {
    const root = await this.#variantRoot(name, source);
    if (!root) return null;
    if (!fnIsSafeWidgetRelativePath(path)) throw new Error('UNSAFE_PATH: Widget file path is unsafe.');
    if (path.split('/').some((part) => this.#isPrivateEntry(part, true) || this.#isPrivateEntry(part, false))) {
      throw new Error('UNSAFE_PATH: Widget file path is private.');
    }
    const parts = path.split('/');
    let absolutePath = root;
    let details: Awaited<ReturnType<typeof lstat>> | null = null;
    for (let index = 0; index < parts.length; index += 1) {
      absolutePath = join(absolutePath, parts[index]!);
      details = await lstat(absolutePath).catch(() => null);
      if (!details) return null;
      if (details.isSymbolicLink()) throw new Error('UNSAFE_PATH: Widget file path contains a symbolic link.');
      if (index < parts.length - 1 && !details.isDirectory()) throw new Error('UNSAFE_PATH: Widget file parent is not a directory.');
    }
    if (!details?.isFile()) throw new Error('UNSAFE_PATH: Widget path must identify a regular file.');
    if (details.size > WIDGET_FILE_READ_MAX_BYTES) throw new Error('PAYLOAD_LIMIT: Widget file exceeds the read limit.');
    const buffer = await readFile(absolutePath);
    const preview = buffer.subarray(0, WIDGET_FILE_TEXT_PREVIEW_MAX_BYTES);
    let text: string | null = null;
    let binary = buffer.includes(0);
    if (!binary) {
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(preview);
      } catch {
        binary = true;
      }
    }
    return {
      path,
      size: details.size,
      binary,
      text: binary ? null : text,
      truncated: buffer.byteLength > preview.byteLength,
    };
  }

  async ensureDraft(name: string, _expectedPublishedFingerprint?: string): Promise<TWidgetVariantSummary> {
    this.#assertName(name);
    const existing = await this.#workspace.getDraft(name);
    if (!existing) throw new Error(`NOT_FOUND: Widget draft '${name}' does not exist.`);
    const variant = await this.#readVariant(name, 'draft');
    return variant.summary;
  }

  async patchDraftTool(name: string, expectedRevision: string, patch: TWidgetDraftToolPatch): Promise<TWidgetVariantSummary> {
    this.#assertName(name);
    if (!Object.prototype.hasOwnProperty.call(patch, 'icon') && !Object.prototype.hasOwnProperty.call(patch, 'group')) {
      throw new Error('INVALID_MANIFEST: No editable tool field was supplied.');
    }
    const workspaceRevision = await this.#drafts.getWorkspaceRevision(name, expectedRevision);
    await this.#workspace.updateDraftManifestAtomic(name, workspaceRevision, (manifestValue) => {
      const parsed = ZWidgetManifestV3.safeParse(manifestValue);
      if (!parsed.success) throw new Error('INVALID_MANIFEST: The widget draft manifest is invalid.');
      throw new Error('INVALID_MANIFEST: Manifest v3 does not expose tool metadata.');
    });
    await this.#drafts.handleToolChange({ name, type: 'changed' });
    return (await this.#readVariant(name, 'draft')).summary;
  }

  async patchDraftMetadata(name: string, expectedRevision: string, patch: TWidgetDraftMetadataPatch): Promise<TWidgetDraftMetadataPatchResult> {
    this.#assertName(name);
    const nextName = patch.name?.trim() || name;
    this.#assertName(nextName);
    if (!Object.prototype.hasOwnProperty.call(patch, 'name')
      && !Object.prototype.hasOwnProperty.call(patch, 'description')
      && patch.tool === undefined) {
      throw new Error('INVALID_MANIFEST: No editable metadata field was supplied.');
    }
    const workspaceRevision = await this.#drafts.getWorkspaceRevision(name, expectedRevision);
    const updateDraft = (coordinateCommit?: (commit: () => Promise<void>) => Promise<void>) => {
      return this.#workspace.updateDraftManifestAndNameAtomic(name, nextName, workspaceRevision, (manifestValue) => {
        const v3 = ZWidgetManifestV3.safeParse(manifestValue);
        if (v3.success) {
          if (patch.tool !== undefined) {
            throw new Error('INVALID_MANIFEST: Manifest v3 does not expose tool metadata.');
          }
          const description = patch.description === undefined
            ? v3.data.description
            : patch.description.trim() || undefined;
          const { description: _description, ...withoutDescription } = v3.data;
          return {
            ...withoutDescription,
            name: nextName,
            ...(description === undefined ? {} : { description }),
          };
        }
        throw new Error('INVALID_MANIFEST: The widget draft manifest is invalid.');
      }, coordinateCommit);
    };
    const result = nextName === name
      ? await updateDraft()
      : await this.#drafts.withDraftRename(name, nextName, (_cleanup, coordinateCommit) => {
          return updateDraft(coordinateCommit);
        });
    await this.#drafts.handleToolChange({ name: result.name, type: 'changed' });
    return { name: result.name, variant: (await this.#readVariant(result.name, 'draft')).summary };
  }

  async delete(name: string, source: TWidgetSource): Promise<TWidgetDeleteResult | null> {
    this.#assertName(name);
    if (!await this.#hasVariant(name, source)) return null;
    if (source === 'draft') {
      let deletedDraft = false;
      try {
        await this.#drafts.withDraftDeletion(name, async (_cleanup, discardBeforeRemoval) => {
          await discardBeforeRemoval();
          deletedDraft = await this.#workspace.removeDraft(name);
        });
        return {
          name,
          source,
          deletedDefinition: false,
          deletedPublished: false,
          deletedDraft,
          deletedInstances: false,
          issues: deletedDraft ? [] : [{ target: 'draft-source', message: 'The widget draft could not be removed.' }],
        };
      } catch {
        return {
          name,
          source,
          deletedDefinition: false,
          deletedPublished: false,
          deletedDraft: false,
          deletedInstances: false,
          issues: [{ target: 'draft-source', message: 'The widget draft could not be removed.' }],
        };
      }
    }

    return null;
  }

  async #catalogEntry(name: string, hasPublished: boolean, hasDraft: boolean): Promise<TWidgetCatalogEntry> {
    const [draft, previewState] = await Promise.all([
      hasDraft ? this.#readVariant(name, 'draft') : Promise.resolve(null),
      hasDraft ? this.#drafts.getPreviewCatalogState(name) : Promise.resolve(null),
    ]);
    let problem = draft?.problem ?? null;
    if (!problem && draft?.manifest && draft.manifest.name !== name) {
      problem = fnWidgetProblem('MANIFEST_NAME_MISMATCH', 'Draft manifest name does not match its managed directory.');
    }
    const relation = hasDraft ? 'draft-only' : 'unknown';
    return {
      name,
      relation,
      published: null,
      draft: draft?.summary ?? null,
      preview: previewState
        ? previewState.status === 'ready' && draft?.summary.placement
          ? {
              status: 'ready',
              revision: previewState.revision,
              placement: {
                reference: { source: 'draft', name, revision: previewState.revision },
                bounds: draft.summary.placement.bounds,
              },
            }
          : {
              status: previewState.status === 'ready' ? 'not-ready' : previewState.status,
              revision: previewState.revision,
              message: previewState.status === 'ready'
                ? 'The validated Preview placement descriptor is unavailable.'
                : previewState.message,
              placement: null,
            }
        : null,
      problem,
    };
  }

  async #readVariant(name: string, source: TWidgetSource): Promise<TVariantRead> {
    if (source === 'published') throw new Error('Published widget source is artifact-backed.');
    const root = join(this.#workspace.draftRoot, name);
    let latestFingerprint: TTreeFingerprint = {
      fingerprint: null,
      updatedAt: null,
      problem: fnWidgetProblem('SOURCE_CHANGED', 'Widget source changed while its catalog snapshot was being read.'),
    };
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const before = await this.#fingerprint(root);
      await this.#afterVariantFingerprint?.({ name, source, attempt });
      const manifestResult = await this.#readManifest(root);
      const draft = source === 'draft' ? await this.#drafts.getByName(name) : null;
      const after = await this.#fingerprint(root);
      latestFingerprint = after;
      if (before.fingerprint !== after.fingerprint) continue;
      const safeManifest = after.fingerprint === null ? null : manifestResult.manifest;
      const revision = source === 'draft'
        ? draft?.revision ?? after.fingerprint ?? 'unknown'
        : after.fingerprint ?? 'unknown';
      const summary = fnWidgetVariantSummary({
        draftId: draft?.draftId ?? null,
        source,
        fallbackName: name,
        manifest: safeManifest,
        revision,
        fingerprint: after.fingerprint,
        updatedAt: source === 'draft' ? draft?.updatedAt ?? after.updatedAt : after.updatedAt,
        validation: source === 'draft' ? draft?.validation ?? null : null,
      });
      if (!safeManifest && manifestResult.groupReference) {
        summary.tool.group = manifestResult.groupReference;
      }
      return {
        summary,
        manifest: safeManifest,
        problem: after.problem
          ?? manifestResult.problem
          ?? (
            source === 'draft' && !draft
              ? fnWidgetProblem(
                'DRAFT_IDENTITY_UNAVAILABLE',
                'Validate this widget again from its owning AI chat before publishing or placing it.',
              )
              : null
          ),
      };
    }
    const draft = source === 'draft' ? await this.#drafts.getByName(name) : null;
    const revision = source === 'draft'
      ? draft?.revision ?? latestFingerprint.fingerprint ?? 'unknown'
      : latestFingerprint.fingerprint ?? 'unknown';
    return {
      summary: fnWidgetVariantSummary({
        draftId: draft?.draftId ?? null,
        source,
        fallbackName: name,
        manifest: null,
        revision,
        fingerprint: latestFingerprint.fingerprint,
        updatedAt: source === 'draft' ? draft?.updatedAt ?? latestFingerprint.updatedAt : latestFingerprint.updatedAt,
        validation: source === 'draft' ? draft?.validation ?? null : null,
      }),
      manifest: null,
      problem: fnWidgetProblem(
        'SOURCE_CHANGED',
        'Widget source changed while its catalog snapshot was being read.',
      ),
    };
  }

  async #readManifest(root: string): Promise<{ manifest: TWidgetManagementManifest | null; problem: TWidgetCatalogProblem | null; groupReference: string | null }> {
    try {
      const raw: unknown = JSON.parse(await readFile(join(root, 'vibecanvas.json'), 'utf8'));
      const v3 = ZWidgetManifestV3.safeParse(raw);
      if (v3.success) {
        return { manifest: v3.data as TWidgetManifestV3, problem: null, groupReference: null };
      }
      return { manifest: null, problem: fnWidgetProblem('INVALID_MANIFEST', 'vibecanvas.json is invalid. Open Config for validation details.'), groupReference: null };
    } catch {
      return { manifest: null, problem: fnWidgetProblem('INVALID_MANIFEST', 'vibecanvas.json is missing, unreadable, or invalid JSON.'), groupReference: null };
    }
  }

  async #fingerprint(root: string): Promise<TTreeFingerprint> {
    const rootEntry = await lstat(root).catch(() => null);
    if (!rootEntry || rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) {
      return { fingerprint: null, updatedAt: null, problem: fnWidgetProblem('AMBIGUOUS_SOURCE', 'Widget source is not a managed directory.') };
    }
    const hash = createHash('sha256');
    let fileCount = 0;
    let totalBytes = 0;
    let updatedAtMs = 0;
    try {
      const walk = async (absoluteDir: string, displayDir: string): Promise<void> => {
        const entries = await readdir(absoluteDir, { withFileTypes: true });
        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
          if (this.#isPrivateEntry(entry.name, entry.isDirectory())) continue;
          if (entry.isSymbolicLink()) throw new Error('symlink');
          const absolutePath = join(absoluteDir, entry.name);
          const displayPath = displayDir ? `${displayDir}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            await walk(absolutePath, displayPath);
            continue;
          }
          if (!entry.isFile()) throw new Error('ambiguous');
          const details = await stat(absolutePath);
          fileCount += 1;
          totalBytes += details.size;
          updatedAtMs = Math.max(updatedAtMs, details.mtimeMs);
          if (fileCount > WIDGET_CATALOG_MAX_FILES || totalBytes > WIDGET_CATALOG_MAX_BYTES) throw new Error('limit');
          hash.update(displayPath);
          hash.update('\0');
          hash.update(await readFile(absolutePath));
          hash.update('\0');
        }
      };
      await walk(root, '');
      return {
        fingerprint: hash.digest('hex'),
        updatedAt: updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : null,
        problem: null,
      };
    } catch (error) {
      const isLimit = error instanceof Error && error.message === 'limit';
      return {
        fingerprint: null,
        updatedAt: updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : null,
        problem: fnWidgetProblem(
          isLimit ? 'SOURCE_LIMIT' : 'AMBIGUOUS_SOURCE',
          isLimit ? 'Widget source exceeds catalog fingerprint limits.' : 'Widget source could not be compared safely.',
        ),
      };
    }
  }

  async #discoverNames(root: string): Promise<Set<string>> {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    return new Set(entries
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && fnIsSafeWidgetName(entry.name) && !this.#isPrivateEntry(entry.name, true))
      .map((entry) => entry.name));
  }

  async #hasVariant(name: string, source: TWidgetSource): Promise<boolean> {
    if (source === 'published') return false;
    return Boolean(await lstat(join(this.#workspace.draftRoot, name)).catch(() => null));
  }

  async #variantRoot(name: string, source: TWidgetSource): Promise<string | null> {
    this.#assertName(name);
    if (source === 'published') return null;
    const root = this.#workspace.draftRoot;
    const candidate = join(root, name);
    const entry = await lstat(candidate).catch(() => null);
    if (!entry) return null;
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('UNSAFE_PATH: Widget source is not a managed directory.');
    return candidate;
  }

  #assertName(name: string): void {
    if (!fnIsSafeWidgetName(name)) throw new Error('UNSAFE_PATH: Widget name is unsafe.');
  }

  #isPrivateEntry(name: string, directory: boolean): boolean {
    if (WIDGET_TRANSIENT_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
    return directory ? WIDGET_PRIVATE_DIRECTORY_NAMES.has(name) : WIDGET_PRIVATE_FILE_NAMES.has(name);
  }
}
