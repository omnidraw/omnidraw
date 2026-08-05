/** @file Impure read of one shared draft folder's raw manifest record. */

type TPortal = {
  lstat(path: string): Promise<{
    isFile(): boolean;
    isSymbolicLink(): boolean;
    size: number;
  }>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  join(...parts: string[]): string;
};

type TArgs = {
  draftPath: string;
};

const MANIFEST_MAX_BYTES = 128 * 1_024;

/** Reads one draft folder's raw manifest record without interpreting it. */
export async function fxReadWidgetManifestRecord(
  portal: TPortal,
  args: TArgs,
): Promise<Record<string, unknown> | null> {
  const path = portal.join(args.draftPath, 'omnidraw.json');
  const fileStat = await portal.lstat(path).catch(() => null);
  if (!fileStat?.isFile() || fileStat.isSymbolicLink() || fileStat.size > MANIFEST_MAX_BYTES) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(await portal.readFile(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
