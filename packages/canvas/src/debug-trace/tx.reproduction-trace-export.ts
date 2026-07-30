type TPortalCopy = Readonly<{
  writeText(text: string): Promise<void>;
}>;

type TArgsCopy = Readonly<{
  text: string;
}>;

type TPortalDownload = Readonly<{
  createObjectUrl(args: Readonly<{ mimeType: string; text: string }>): string;
  revokeObjectUrl(url: string): void;
  clickDownload(args: Readonly<{ filename: string; url: string }>): void;
}>;

type TArgsDownload = Readonly<{
  filename: string;
  text: string;
}>;

export async function txCopyReproductionTrace(
  portal: TPortalCopy,
  args: TArgsCopy,
): Promise<void> {
  await portal.writeText(args.text);
}

export function txDownloadReproductionTrace(
  portal: TPortalDownload,
  args: TArgsDownload,
): void {
  const url = portal.createObjectUrl({
    mimeType: 'application/x-ndjson;charset=utf-8',
    text: args.text,
  });
  try {
    portal.clickDownload({ filename: args.filename, url });
  } finally {
    portal.revokeObjectUrl(url);
  }
}
