import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import { ZVibecanvasJson } from '@vibecanvas/service-actor/core/vibecanvasjson.zod';
import type { WidgetDraftController } from '../widget-drafts/WidgetDraftController';
import type { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import { fnPatchDraftManifest } from '../core/fn.patch-draft-manifest';
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
  fnWidgetRelation,
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
  TWidgetSource,
  TWidgetVariantSummary,
} from './types';

type TWidgetManagementConfig = {
  workspace: WidgetWorkspace;
  drafts: WidgetDraftController;
  deletePublishedDefinition?: (name: string) => Promise<boolean>;
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
  manifest: TVibecanvasJson | null;
  problem: TWidgetCatalogProblem | null;
};

export class WidgetManagement {
  readonly #workspace: WidgetWorkspace;
  readonly #drafts: WidgetDraftController;
  readonly #deletePublishedDefinition?: (name: string) => Promise<boolean>;
  readonly #afterVariantFingerprint?: TWidgetManagementConfig['afterVariantFingerprint'];

  constructor(config: TWidgetManagementConfig) {
    this.#workspace = config.workspace;
    this.#drafts = config.drafts;
    this.#deletePublishedDefinition = config.deletePublishedDefinition;
    this.#afterVariantFingerprint = config.afterVariantFingerprint;
  }

  async catalog(groups: TWidgetCatalogGroup[]): Promise<TWidgetCatalog> {
    const [publishedNames, draftNames] = await Promise.all([
      this.#discoverNames(this.#workspace.publishedRoot),
      this.#discoverNames(this.#workspace.draftRoot),
    ]);
    const names = [...new Set([...publishedNames, ...draftNames])].sort((left, right) => left.localeCompare(right));
    const widgets = await Promise.all(names.map((name) => this.#catalogEntry(name, publishedNames.has(name), draftNames.has(name))));
    const sortedGroups = [...groups].sort((left, right) => left.name.localeCompare(right.name));
    const sortedWidgets = fnSortWidgetEntries(widgets);
    const generation = createHash('sha256')
      .update(JSON.stringify({ groups: sortedGroups, widgets: sortedWidgets }))
      .digest('hex');
    return { generation, groups: sortedGroups, widgets: sortedWidgets };
  }

  async detail(name: string, source: TWidgetSource): Promise<TWidgetDetail | null> {
    this.#assertName(name);
    const [publishedExists, draftExists] = await Promise.all([
      this.#hasVariant(name, 'published'),
      this.#hasVariant(name, 'draft'),
    ]);
    const selectedExists = source === 'published' ? publishedExists : draftExists;
    if (!selectedExists) return null;
    const entry = await this.#catalogEntry(name, publishedExists, draftExists);
    const selected = await this.#readVariant(name, source);
    const sibling = source === 'published' ? entry.draft : entry.published;
    return {
      name,
      source,
      relation: entry.relation,
      variant: selected.summary,
      sibling,
      manifest: selected.manifest,
      problem: selected.problem ?? entry.problem,
    };
  }

  async resolvePlacementReference(reference: import('@vibecanvas/service-actor/core/fn.widget-frame').TWidgetPlacementRef): Promise<TWidgetPlacementResolveResult> {
    const source: TWidgetSource = reference.source === 'published' ? 'published' : 'draft';
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
    if (reference.source === 'published') {
      return {
        ok: true,
        descriptor: {
          reference,
          bounds: detail.variant.placement.bounds,
          kind: 'published-legacy',
          definitionId: null,
          revisionId: null,
          definitionName: detail.manifest.name,
          definitionSlug: detail.manifest.slug,
          previewId: null,
        },
      };
    }
    return {
      ok: true,
      descriptor: {
        reference,
        bounds: detail.variant.placement.bounds,
        kind: 'preview',
        definitionId: null,
        revisionId: null,
        definitionName: null,
        definitionSlug: null,
        previewId: null,
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

  async ensureDraft(name: string, expectedPublishedFingerprint?: string): Promise<TWidgetVariantSummary> {
    this.#assertName(name);
    const existing = await this.#workspace.getDraft(name);
    if (!existing) {
      const fingerprint = await this.#fingerprint(join(this.#workspace.publishedRoot, name));
      if (fingerprint.fingerprint === null) {
        throw new Error('INVALID_MANIFEST: Published widget source cannot be copied safely.');
      }
      if (expectedPublishedFingerprint && fingerprint.fingerprint !== expectedPublishedFingerprint) {
        throw new Error('STALE_REVISION: Published widget changed before the draft was created.');
      }
      await this.#workspace.ensureDraftFromPublished(name);
      if (expectedPublishedFingerprint) {
        const copied = await this.#fingerprint(join(this.#workspace.draftRoot, name));
        if (copied.fingerprint !== expectedPublishedFingerprint) {
          throw new Error('STALE_REVISION: Published widget changed while the draft was being created.');
        }
      }
      await this.#drafts.handleToolChange({ name, type: 'created' });
    }
    const variant = await this.#readVariant(name, 'draft');
    return variant.summary;
  }

  async patchDraftTool(name: string, expectedRevision: string, patch: TWidgetDraftToolPatch): Promise<TWidgetVariantSummary> {
    this.#assertName(name);
    if (!Object.prototype.hasOwnProperty.call(patch, 'icon') && !Object.prototype.hasOwnProperty.call(patch, 'group')) {
      throw new Error('INVALID_MANIFEST: No editable tool field was supplied.');
    }
    await this.#workspace.updateDraftManifestAtomic(name, expectedRevision, (manifestValue) => {
      const parsed = ZVibecanvasJson.safeParse(manifestValue);
      if (!parsed.success) throw new Error('INVALID_MANIFEST: The widget draft manifest is invalid.');
      const plan = fnPatchDraftManifest({
        manifest: parsed.data as TVibecanvasJson,
        patch: { tool: { ...patch, group: patch.group?.trim() || patch.group } },
      });
      if (plan.issues.length > 0) throw new Error(`INVALID_MANIFEST: ${plan.issues.join('; ')}`);
      const validated = ZVibecanvasJson.safeParse(plan.manifest);
      if (!validated.success) throw new Error('INVALID_MANIFEST: The requested tool metadata is invalid.');
      return validated.data as TVibecanvasJson;
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
    const updateDraft = (coordinateCommit?: (commit: () => Promise<void>) => Promise<void>) => {
      return this.#workspace.updateDraftManifestAndNameAtomic(name, nextName, expectedRevision, (manifestValue) => {
        const parsed = ZVibecanvasJson.safeParse(manifestValue);
        if (!parsed.success) throw new Error('INVALID_MANIFEST: The widget draft manifest is invalid.');
        const plan = fnPatchDraftManifest({
          manifest: parsed.data as TVibecanvasJson,
          patch: {
            ...patch,
            name: nextName,
            tool: patch.tool ? { ...patch.tool, group: patch.tool.group?.trim() || patch.tool.group } : undefined,
          },
        });
        if (plan.issues.length > 0) throw new Error(`INVALID_MANIFEST: ${plan.issues.join('; ')}`);
        const validated = ZVibecanvasJson.safeParse(plan.manifest);
        if (!validated.success) throw new Error('INVALID_MANIFEST: The requested widget metadata is invalid.');
        return validated.data as TVibecanvasJson;
      }, coordinateCommit);
    };
    const result = nextName === name
      ? await updateDraft()
      : await this.#drafts.withPreviewRenameCleanup(name, nextName, (cleanup) => {
          return updateDraft(async (commit) => {
            await cleanup();
            await commit();
          });
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
        await this.#drafts.withPreviewCleanup(name, async (cleanup) => {
          await cleanup();
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

    const hadDraft = await this.#hasVariant(name, 'draft');
    const published = await this.#readVariant(name, 'published');
    const definitionName = published.manifest?.name ?? name;
    const issues: TWidgetDeleteResult['issues'] = [];
    let deletedDefinition = false;

    const [publishedCleanup, draftCleanup] = await this.#drafts.withPreviewCleanup(name, async (cleanup) => {
      await cleanup();
      if (this.#deletePublishedDefinition) {
        try {
          deletedDefinition = await this.#deletePublishedDefinition(definitionName);
          if (!deletedDefinition) {
            issues.push({
              target: 'runtime-definition',
              message: 'No matching runtime definition was found, so no associated instances could be identified.',
            });
          }
        } catch {
          issues.push({
            target: 'runtime-definition',
            message: 'The runtime definition and its instances could not be fully removed.',
          });
        }
      } else {
        issues.push({
          target: 'runtime-definition',
          message: 'Runtime cleanup is unavailable in this host.',
        });
      }
      return Promise.allSettled([
        this.#workspace.removePublished(name),
        this.#workspace.removeDraft(name),
      ]);
    });
    if (publishedCleanup.status === 'rejected') {
      issues.push({ target: 'published-source', message: 'The published widget source could not be removed.' });
    }
    if (draftCleanup.status === 'rejected') {
      issues.push({ target: 'draft-source', message: 'The widget draft could not be removed.' });
    }

    const [publishedRemains, draftRemains] = await Promise.all([
      this.#hasVariant(name, 'published'),
      this.#hasVariant(name, 'draft'),
    ]);
    const deletedPublished = !publishedRemains;
    const deletedDraft = hadDraft && !draftRemains;
    if (publishedRemains && !issues.some((issue) => issue.target === 'published-source')) {
      issues.push({ target: 'published-source', message: 'The published widget source could not be removed.' });
    }
    if (hadDraft && draftRemains && !issues.some((issue) => issue.target === 'draft-source')) {
      issues.push({ target: 'draft-source', message: 'The widget draft could not be removed.' });
    }

    return {
      name,
      source,
      deletedDefinition,
      deletedPublished,
      deletedDraft,
      deletedInstances: deletedDefinition,
      issues,
    };
  }

  async #catalogEntry(name: string, hasPublished: boolean, hasDraft: boolean): Promise<TWidgetCatalogEntry> {
    const [published, draft, previewState, cleanDraftRevision] = await Promise.all([
      hasPublished ? this.#readVariant(name, 'published') : Promise.resolve(null),
      hasDraft ? this.#readVariant(name, 'draft') : Promise.resolve(null),
      hasDraft ? this.#drafts.getPreviewCatalogState(name) : Promise.resolve(null),
      hasPublished && hasDraft ? this.#workspace.getCleanDraftRevision(name) : Promise.resolve(null),
    ]);
    let problem = published?.problem ?? draft?.problem ?? null;
    if (!problem && published?.manifest && published.manifest.name !== name) {
      problem = fnWidgetProblem('MANIFEST_NAME_MISMATCH', 'Published manifest name does not match its managed directory.');
    }
    if (!problem && draft?.manifest && draft.manifest.name !== name) {
      problem = fnWidgetProblem('MANIFEST_NAME_MISMATCH', 'Draft manifest name does not match its managed directory.');
    }
    const relation = fnWidgetRelation({
      hasPublished,
      hasDraft,
      publishedFingerprint: published?.summary.contentFingerprint ?? null,
      draftFingerprint: draft?.summary.contentFingerprint ?? null,
      cleanDraftRevision,
      draftRevision: draft?.summary.revision ?? null,
      hasProblem: problem !== null,
    });
    return {
      name,
      relation,
      published: published?.summary ?? null,
      draft: draft?.summary ?? null,
      preview: previewState && draft?.summary.placement
        ? previewState.status === 'ready'
          ? {
              status: 'ready',
              revision: previewState.revision,
              placement: {
                reference: { source: 'preview', name, revision: previewState.revision },
                bounds: draft.summary.placement.bounds,
              },
            }
          : { status: previewState.status, revision: previewState.revision, message: previewState.message, placement: null }
        : null,
      problem,
    };
  }

  async #readVariant(name: string, source: TWidgetSource): Promise<TVariantRead> {
    const root = join(source === 'published' ? this.#workspace.publishedRoot : this.#workspace.draftRoot, name);
    let latestFingerprint: TTreeFingerprint = {
      fingerprint: null,
      updatedAt: null,
      problem: fnWidgetProblem('SOURCE_CHANGED', 'Widget source changed while its catalog snapshot was being read.'),
    };
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const before = await this.#fingerprint(root);
      await this.#afterVariantFingerprint?.({ name, source, attempt });
      const manifestResult = await this.#readManifest(root);
      const draft = source === 'draft' ? await this.#drafts.get(name) : null;
      const after = await this.#fingerprint(root);
      latestFingerprint = after;
      if (before.fingerprint !== after.fingerprint) continue;
      const safeManifest = after.fingerprint === null ? null : manifestResult.manifest;
      const revision = source === 'draft'
        ? draft?.revision ?? after.fingerprint ?? 'unknown'
        : after.fingerprint ?? 'unknown';
      const summary = fnWidgetVariantSummary({
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
        problem: after.problem ?? manifestResult.problem,
      };
    }
    const draft = source === 'draft' ? await this.#drafts.get(name) : null;
    const revision = source === 'draft'
      ? draft?.revision ?? latestFingerprint.fingerprint ?? 'unknown'
      : latestFingerprint.fingerprint ?? 'unknown';
    return {
      summary: fnWidgetVariantSummary({
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

  async #readManifest(root: string): Promise<{ manifest: TVibecanvasJson | null; problem: TWidgetCatalogProblem | null; groupReference: string | null }> {
    try {
      const raw: unknown = JSON.parse(await readFile(join(root, 'vibecanvas.json'), 'utf8'));
      const rawGroup = raw && typeof raw === 'object' && 'widget' in raw
        && raw.widget && typeof raw.widget === 'object' && 'tool' in raw.widget
        && raw.widget.tool && typeof raw.widget.tool === 'object' && 'group' in raw.widget.tool
        ? raw.widget.tool.group
        : null;
      const groupReference = typeof rawGroup === 'string' && rawGroup.trim().length > 0 && rawGroup.trim().length <= 120
        ? rawGroup.trim()
        : null;
      const parsed = ZVibecanvasJson.safeParse(raw);
      if (!parsed.success) return { manifest: null, problem: fnWidgetProblem('INVALID_MANIFEST', 'vibecanvas.json is invalid. Open Config for validation details.'), groupReference };
      return { manifest: parsed.data as TVibecanvasJson, problem: null, groupReference };
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
    const root = source === 'published' ? this.#workspace.publishedRoot : this.#workspace.draftRoot;
    return Boolean(await lstat(join(root, name)).catch(() => null));
  }

  async #variantRoot(name: string, source: TWidgetSource): Promise<string | null> {
    this.#assertName(name);
    const root = source === 'published' ? this.#workspace.publishedRoot : this.#workspace.draftRoot;
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
