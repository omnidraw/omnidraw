import type { Dirent, Stats } from 'node:fs';
import { fnIsWidgetDraftSlug, fnNormalizeWidgetName } from './fn.names';
import type { TAvailableWidget } from './types';

type TPortal = {
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  lstat(path: string): Promise<Stats>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  realpath(path: string): Promise<string>;
  join(...parts: string[]): string;
  dirname(path: string): string;
  parseManifest(value: unknown):
    | { ok: true; name: string; slug: string; kind: 'widget' | null }
    | { ok: false };
};

type TArgs = {
  draftRoot: string;
  mountedNames: string[];
};

const MANIFEST_MAX_BYTES = 256_000;
const INTERNAL_DIRECTORY_PREFIXES = [
  '.create-',
  '.snapshot-',
  '.materialize-',
];

function isInternalDirectory(name: string): boolean {
  return INTERNAL_DIRECTORY_PREFIXES.some((prefix) => name.startsWith(prefix));
}

async function directDirectoryNames(portal: TPortal, root: string): Promise<string[]> {
  const resolvedRoot = await portal.realpath(root);
  const entries = await portal.readdir(root, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (isInternalDirectory(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const candidate = portal.join(root, entry.name);
    const candidateStat = await portal.lstat(candidate).catch(() => null);
    if (!candidateStat?.isDirectory() || candidateStat.isSymbolicLink()) continue;
    const resolved = await portal.realpath(candidate).catch(() => null);
    if (!resolved || portal.dirname(resolved) !== resolvedRoot) continue;
    names.push(entry.name);
  }
  return names;
}

async function readManifest(
  portal: TPortal,
  root: string,
  folder: string,
): Promise<Record<string, unknown> | null> {
  const path = portal.join(root, folder, 'omnidraw.json');
  const fileStat = await portal.lstat(path).catch(() => null);
  if (!fileStat?.isFile() || fileStat.isSymbolicLink() || fileStat.size > MANIFEST_MAX_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(await portal.readFile(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * Lists the shared draft root for the agent. Draft folders are named by
 * manifest slug; the widget display name always comes from the manifest.
 */
export async function fxWidgetCatalog(portal: TPortal, args: TArgs): Promise<TAvailableWidget[]> {
  const folderNames = await directDirectoryNames(portal, args.draftRoot);
  const mounted = new Set(args.mountedNames.map((name) => fnNormalizeWidgetName(name)).flatMap((result) => (
    result.ok ? [result.caseKey] : []
  )));
  const widgets: TAvailableWidget[] = [];

  for (const folder of folderNames) {
    if (!fnIsWidgetDraftSlug(folder)) continue;
    const manifest = await readManifest(portal, args.draftRoot, folder);
    const parsed = manifest ? portal.parseManifest(manifest) : { ok: false as const };
    if (!parsed.ok) {
      widgets.push({
        name: folder,
        kind: null,
        hasDraft: true,
        hasPublished: false,
        mountedInThisChat: false,
        problemCode: 'WIDGET_MANIFEST_INVALID',
      });
      continue;
    }
    const normalizedName = fnNormalizeWidgetName(parsed.name);
    const mountable = normalizedName.ok && normalizedName.value === parsed.name;
    widgets.push({
      name: mountable ? parsed.name : folder,
      kind: parsed.kind,
      hasDraft: true,
      hasPublished: false,
      mountedInThisChat: mountable && mounted.has(normalizedName.caseKey),
      problemCode: parsed.slug !== folder
        ? 'WIDGET_DIRECTORY_NAME_INVALID'
        : mountable
          ? null
          : 'WIDGET_MANIFEST_NAME_MISMATCH',
    });
  }

  const byCaseKey = new Map<string, string[]>();
  for (const widget of widgets) {
    const caseKey = widget.name.toLocaleLowerCase('en-US');
    byCaseKey.set(caseKey, [...(byCaseKey.get(caseKey) ?? []), widget.name]);
  }
  for (const widget of widgets) {
    if (widget.problemCode !== null) continue;
    const names = byCaseKey.get(widget.name.toLocaleLowerCase('en-US')) ?? [];
    if (names.length > 1 || names[0] !== widget.name) {
      widget.problemCode = 'WIDGET_NAME_AMBIGUOUS';
    }
  }

  return widgets.sort((left, right) => left.name.localeCompare(right.name));
}
