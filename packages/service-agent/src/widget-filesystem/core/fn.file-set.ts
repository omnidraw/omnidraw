export type TWidgetObservedFile = Readonly<{
  path: string;
  byteSize: number;
  sha256: string;
}>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Canonical file-byte observation shared by catalog scans and draft captures. */
export function fnCanonicalizeWidgetObservedFileSet(
  files: readonly TWidgetObservedFile[],
): string {
  return JSON.stringify([...files]
    .sort((left, right) => compareText(left.path, right.path))
    .map((file) => ({
      path: file.path,
      byteSize: file.byteSize,
      sha256: file.sha256,
    })));
}
