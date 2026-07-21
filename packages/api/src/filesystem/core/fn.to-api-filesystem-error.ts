function fnToApiFilesystemError(error: TErrorEntry | null | undefined, fallbackMessage: string) {
  return {
    type: error?.code ?? 'ERROR',
    message: error?.externalMessage?.en ?? fallbackMessage,
  };
}

export { fnToApiFilesystemError };
