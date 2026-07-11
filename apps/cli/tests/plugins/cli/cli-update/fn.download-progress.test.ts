import { describe, expect, test } from 'bun:test';
import {
  fnDownloadMonotonicPercent,
  fnDownloadOverallPercent,
  fnFormatDownloadLabel,
  fnShouldEmitProgress,
} from '../../../../src/plugins/cli/cmds/fn.download-progress';

describe('download progress', () => {
  test('maps known byte totals into a bounded overall range', () => {
    expect(fnDownloadOverallPercent({ downloadedBytes: 50, totalBytes: 100 }, 85, 91)).toBe(88);
    expect(fnDownloadOverallPercent({ downloadedBytes: 200, totalBytes: 100 }, 85, 91)).toBe(91);
  });

  test('keeps unknown totals indeterminate and labels transferred bytes only', () => {
    expect(fnDownloadOverallPercent({ downloadedBytes: 42_700_000 }, 85, 91)).toBe(85);
    expect(fnFormatDownloadLabel('candidate.tar.gz', { downloadedBytes: 42_700_000 }))
      .toBe('Downloading candidate.tar.gz 42.7 MB');
  });

  test('never moves progress backward', () => {
    expect(fnDownloadMonotonicPercent(89, 87)).toBe(89);
  });

  test('throttles frequent byte-label changes', () => {
    const base = {
      lastEmittedAtMs: 1_000,
      percent: 86,
      lastPercent: 86,
      label: 'Downloading archive 2.0 MB / 10.0 MB',
      lastLabel: 'Downloading archive 1.0 MB / 10.0 MB',
      isTTY: true,
      isIndeterminate: true,
    };
    expect(fnShouldEmitProgress({ ...base, nowMs: 1_050 })).toBe(false);
    expect(fnShouldEmitProgress({ ...base, nowMs: 1_100 })).toBe(true);
  });
});
