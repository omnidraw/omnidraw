/** Dormant host-owned Secret Store limits and operation effects. */

export const SECRET_STORE_OPERATION_LIMITS = Object.freeze({
  nameBytes: 1_024,
  valueBytes: 1_048_576,
  listLimit: 500,
});

const SECRET_STORE_OPERATION_EFFECTS = Object.freeze({
  get: 'read',
  has: 'read',
  list: 'read',
  set: 'write',
  delete: 'write',
  compareAndSet: 'write',
} as const);

export function fnGetSecretStoreOperation(operation: string): Readonly<{ effect: 'read' | 'write' }> {
  const effect = SECRET_STORE_OPERATION_EFFECTS[operation as keyof typeof SECRET_STORE_OPERATION_EFFECTS];
  if (effect === undefined) throw new TypeError(`Unknown secret-store operation '${operation}'.`);
  return Object.freeze({ effect });
}
