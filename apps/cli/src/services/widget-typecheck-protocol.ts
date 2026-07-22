type TWidgetTypecheckSourceFileMessage = Readonly<{
  path: string;
  bytesBase64: string;
}>;

export type TWidgetTypecheckRequestMessage = Readonly<{
  type: 'validate';
  requestId: string;
  limits: Readonly<{
    deadlineAtMs: number;
    memoryLimitBytes: number;
  }>;
  snapshot: Readonly<{
    id: string;
    digestSha256: string;
    createdAtMs: number;
    files: readonly TWidgetTypecheckSourceFileMessage[];
  }>;
}>;

export type TWidgetTypecheckWorkerMessage =
  | Readonly<{ type: 'ready' }>
  | Readonly<{
      type: 'result';
      requestId: string;
      diagnostics: readonly string[];
    }>
  | Readonly<{
      type: 'failure';
      requestId: string;
      message: string;
    }>;
