import type { Dirent, Stats } from 'node:fs';
import { fnNormalizeWidgetName } from './fn.names';
import type { TAvailableWidget } from './types';

type TPortal = {
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  lstat(path: string): Promise<Stats>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  realpath(path: string): Promise<string>;
  join(...parts: string[]): string;
  dirname(path: string): string;
  parseManifest(value: unknown):
    | { ok: true; name: string; kind: 'widget' | null }
    | { ok: false };
};

type TArgs = {
  draftRoot: string;
  mountedNames: string[];
};

type TCandidate = {
  names: Set<string>;
  draftNames: Set<string>;
};

const MANIFEST_MAX_BYTES = 256_000;
const INTERNAL_DIRECTORY_PREFIXES = [
  '.create-',
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
  name: string,
): Promise<Record<string, unknown> | null> {
  const path = portal.join(root, name, 'omnidraw.json');
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

function addCandidate(catalog: Map<string, TCandidate>, directoryName: string): void {
  const normalized = fnNormalizeWidgetName(directoryName);
  if (!normalized.ok) return;
  const candidate = catalog.get(normalized.caseKey) ?? {
    names: new Set<string>(),
    draftNames: new Set<string>(),
  };
  candidate.names.add(directoryName);
  candidate.draftNames.add(directoryName);
  catalog.set(normalized.caseKey, candidate);
}

export async function fxWidgetCatalog(portal: TPortal, args: TArgs): Promise<TAvailableWidget[]> {
  const draftNames = await directDirectoryNames(portal, args.draftRoot);
  const catalog = new Map<string, TCandidate>();
  for (const name of draftNames) addCandidate(catalog, name);
  const mounted = new Set(args.mountedNames.map((name) => fnNormalizeWidgetName(name)).flatMap((result) => (
    result.ok ? [result.caseKey] : []
  )));
  const widgets: TAvailableWidget[] = [];

  for (const [caseKey, candidate] of catalog) {
    const names = [...candidate.names].sort();
    const normalized = fnNormalizeWidgetName(names[0]!);
    if (!normalized.ok) continue;
    const name = normalized.value;
    const hasDraft = candidate.draftNames.size > 0;
    let problemCode: string | null = null;
    if (names.length > 1) problemCode = 'WIDGET_NAME_AMBIGUOUS';
    else if (names[0] !== name) problemCode = 'WIDGET_DIRECTORY_NAME_INVALID';

    const sourceRoot = candidate.draftNames.has(name) ? args.draftRoot : null;
    const manifest = sourceRoot ? await readManifest(portal, sourceRoot, name) : null;
    const parsedManifest = manifest ? portal.parseManifest(manifest) : { ok: false as const };
    if (!problemCode && !parsedManifest.ok) problemCode = 'WIDGET_MANIFEST_INVALID';
    if (!problemCode && parsedManifest.ok && parsedManifest.name !== name) {
      problemCode = 'WIDGET_MANIFEST_NAME_MISMATCH';
    }
    const kind = parsedManifest.ok ? parsedManifest.kind : null;

    widgets.push({
      name,
      kind,
      hasDraft,
      hasPublished: false,
      mountedInThisChat: mounted.has(caseKey),
      problemCode,
    });
  }

  return widgets;
}
