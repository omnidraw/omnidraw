export function fnBumpWidgetVersion(version: string | undefined): string {
  if (version === undefined || version.trim().length === 0) {
    return '1';
  }

  const trimmed = version.trim();

  if (/^\d+$/.test(trimmed)) {
    return String(Number(trimmed) + 1);
  }

  const semverMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(trimmed);
  if (semverMatch) {
    return `${semverMatch[1]}.${semverMatch[2]}.${Number(semverMatch[3]) + 1}`;
  }

  return `${trimmed}.1`;
}
