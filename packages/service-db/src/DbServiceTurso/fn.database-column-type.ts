const BASE_COLUMN_TYPE_BY_DECLARED_TYPE = Object.freeze({
  agent_draft_status: 'TEXT',
  boolean: 'INTEGER',
  function_attempt_status: 'TEXT',
  function_invocation_status: 'TEXT',
  json: 'TEXT',
  resource_apply_status: 'TEXT',
  resource_catalog_status: 'TEXT',
  resource_draft_status: 'TEXT',
  sha256_hex: 'TEXT',
  usage_outcome: 'TEXT',
} as const satisfies Readonly<Record<string, 'INTEGER' | 'TEXT'>>);

function fnDatabaseColumnBaseType(declaredType: string): string {
  const normalizedType = declaredType.toLowerCase() as keyof typeof BASE_COLUMN_TYPE_BY_DECLARED_TYPE;
  return BASE_COLUMN_TYPE_BY_DECLARED_TYPE[normalizedType]
    ?? declaredType;
}

export { fnDatabaseColumnBaseType };
