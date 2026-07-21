function fnCreateFilesystemError(code: string, message: string, statusCode = 500) {
  return {
    code: code as TErrorCode,
    statusCode: statusCode as TErrorStatus,
    externalMessage: { en: message },
  } satisfies TErrorEntry;
}

export { fnCreateFilesystemError };
