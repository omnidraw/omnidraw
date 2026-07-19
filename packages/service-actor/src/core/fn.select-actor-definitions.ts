import type { TResolvedVibecanvasJson } from './types';

export type TActorDefinitionCandidate = TResolvedVibecanvasJson & {
  readonly manifest_path: string;
};

export type TActorDefinitionDuplicate = {
  readonly name: string;
  readonly candidateManifestPaths: readonly string[];
  readonly selectedManifestPath: string | null;
  readonly ignoredManifestPaths: readonly string[];
};

export type TArgs = {
  readonly candidates: readonly TActorDefinitionCandidate[];
};

function manifestDirectoryName(manifestPath: string): string | null {
  const parts = manifestPath.replaceAll('\\', '/').split('/').filter(Boolean);
  return parts.at(-2) ?? null;
}

function isCanonicalSlugDirectory(candidate: TActorDefinitionCandidate): boolean {
  return manifestDirectoryName(candidate.manifest_path) === candidate.slug;
}

function compareManifestPaths(left: TActorDefinitionCandidate, right: TActorDefinitionCandidate): number {
  if (left.manifest_path < right.manifest_path) return -1;
  if (left.manifest_path > right.manifest_path) return 1;
  return 0;
}

export function fnSelectActorDefinitions(args: TArgs): {
  definitions: Record<string, TActorDefinitionCandidate>;
  duplicates: TActorDefinitionDuplicate[];
} {
  const candidatesByName = new Map<string, TActorDefinitionCandidate[]>();
  for (const candidate of args.candidates) {
    const current = candidatesByName.get(candidate.name) ?? [];
    current.push(candidate);
    candidatesByName.set(candidate.name, current);
  }

  const definitions: Record<string, TActorDefinitionCandidate> = {};
  const duplicates: TActorDefinitionDuplicate[] = [];
  for (const [name, unorderedCandidates] of candidatesByName) {
    const candidates = [...unorderedCandidates].sort(compareManifestPaths);
    if (candidates.length === 1) {
      definitions[name] = candidates[0];
      continue;
    }

    const canonical = candidates.filter(isCanonicalSlugDirectory);
    const selected = canonical.length === 1 ? canonical[0] : null;
    if (selected) definitions[name] = selected;
    duplicates.push({
      name,
      candidateManifestPaths: candidates.map((candidate) => candidate.manifest_path),
      selectedManifestPath: selected?.manifest_path ?? null,
      ignoredManifestPaths: selected
        ? candidates.filter((candidate) => candidate !== selected).map((candidate) => candidate.manifest_path)
        : candidates.map((candidate) => candidate.manifest_path),
    });
  }

  return { definitions, duplicates };
}
