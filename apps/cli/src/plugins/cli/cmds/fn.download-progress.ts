export type TDownloadProgress = {
  downloadedBytes: number;
  totalBytes?: number;
};

export type TProgressThrottleInput = {
  nowMs: number;
  lastEmittedAtMs: number;
  percent: number;
  lastPercent: number;
  label: string;
  lastLabel: string;
  isTTY: boolean;
  isIndeterminate: boolean;
};

export function fnDownloadOverallPercent(
  progress: TDownloadProgress,
  startPercent: number,
  endPercent: number,
): number {
  if (!progress.totalBytes || progress.totalBytes <= 0) return startPercent;
  const ratio = Math.max(0, Math.min(1, progress.downloadedBytes / progress.totalBytes));
  return startPercent + ratio * (endPercent - startPercent);
}

export function fnDownloadMonotonicPercent(previous: number, next: number): number {
  return Math.max(previous, next);
}

export function fnFormatDownloadLabel(assetName: string, progress: TDownloadProgress): string {
  const downloaded = fnFormatBytes(progress.downloadedBytes);
  const total = progress.totalBytes ? ` / ${fnFormatBytes(progress.totalBytes)}` : '';
  return `Downloading ${assetName} ${downloaded}${total}`;
}

export function fnFormatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

export function fnShouldEmitProgress(input: TProgressThrottleInput): boolean {
  if (input.lastEmittedAtMs < 0) return true;
  const intervalMs = input.isTTY ? 100 : 1_000;
  const percentStep = input.isTTY ? 1 : 5;
  return input.nowMs - input.lastEmittedAtMs >= intervalMs
    && (input.isIndeterminate || input.percent >= input.lastPercent + percentStep);
}
