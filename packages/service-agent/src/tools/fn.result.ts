export function fnToolSuccess(text: string, details?: unknown) {
  return {
    content: [{ type: 'text' as const, text }],
    details: details ?? {},
  };
}

export function fnToolError(text: string, details?: unknown) {
  return {
    content: [{ type: 'text' as const, text }],
    details: details ?? {},
    isError: true,
  };
}
