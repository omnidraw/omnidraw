function fnTimestampFromMs(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Stored millisecond timestamp is invalid.');
  }

  return new Date(value).toISOString();
}

function fnNullableTimestampFromMs(value: unknown): string | null {
  return value === null ? null : fnTimestampFromMs(value);
}

function fnTimestampToMs(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new Error('Timestamp cursor is invalid.');
  }

  return timestamp;
}

function fnBooleanFromSql(value: unknown): boolean {
  if (value !== 0 && value !== 1 && typeof value !== 'boolean') {
    throw new Error('Stored SQL boolean is invalid.');
  }

  return Boolean(value);
}

export {
  fnBooleanFromSql,
  fnNullableTimestampFromMs,
  fnTimestampFromMs,
  fnTimestampToMs,
};
