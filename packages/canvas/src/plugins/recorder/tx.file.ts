export type TPortalTxSaveJsonFile = {
  document: Document;
  url: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  createBlob: (parts: BlobPart[], options: BlobPropertyBag) => Blob;
  isAbortError: (error: unknown) => boolean;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<{
    createWritable: () => Promise<{
      write: (data: string) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};

export type TArgsTxSaveJsonFile = {
  fileName: string;
  content: string;
};

function downloadJsonFile(portal: TPortalTxSaveJsonFile, args: TArgsTxSaveJsonFile) {
  const blob = portal.createBlob([args.content], { type: "application/json" });
  const href = portal.url.createObjectURL(blob);
  const anchor = portal.document.createElement("a");
  anchor.href = href;
  anchor.download = args.fileName;
  portal.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  portal.url.revokeObjectURL(href);
}

export async function txSaveJsonFile(portal: TPortalTxSaveJsonFile, args: TArgsTxSaveJsonFile) {
  if (!portal.showSaveFilePicker) {
    downloadJsonFile(portal, args);
    return;
  }

  try {
    const handle = await portal.showSaveFilePicker({
      suggestedName: args.fileName,
      types: [
        {
          description: "JSON files",
          accept: { "application/json": [".json"] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(args.content);
    await writable.close();
  } catch (error) {
    if (portal.isAbortError(error)) {
      return;
    }

    throw error;
  }
}
