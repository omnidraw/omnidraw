function normalizePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (normalized === "/") return "/";
  return normalized.replace(/\/+$/, "");
}

export function toRelativePathWithinBase(targetPath: string, basePath: string | null): string | null {
  if (!basePath) return null;

  const normalizedTarget = normalizePath(targetPath);
  const normalizedBase = normalizePath(basePath);

  if (normalizedTarget === normalizedBase) return ".";
  if (!normalizedTarget.startsWith(`${normalizedBase}/`)) return null;

  return normalizedTarget.slice(normalizedBase.length + 1);
}

export function toTildePath(path: string, homePath: string | null): string {
  if (!homePath) return path;

  const normalizedPath = normalizePath(path);
  const normalizedHome = normalizePath(homePath);

  if (normalizedPath === normalizedHome) return "~";
  if (normalizedPath.startsWith(`${normalizedHome}/`)) {
    return `~${normalizedPath.slice(normalizedHome.length)}`;
  }

  return path;
}

export function expandTildePath(path: string, homePath: string | null): string {
  const trimmed = path.trim();
  if (!homePath || !trimmed.startsWith("~")) return trimmed;

  const normalizedHome = normalizePath(homePath);
  if (trimmed === "~") return normalizedHome;

  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    const suffix = trimmed.slice(2).replaceAll("\\", "/");
    if (!suffix) return normalizedHome;
    return `${normalizedHome}/${suffix}`;
  }

  return trimmed;
}
