type TMigration = Readonly<{
  type: 'sql';
  name: string;
  version: number;
  path: string;
}>;

type TMigrationLedgerRow = {
  version: number;
  name: string;
  checksum_sha256: string;
  applied_at_ms: number;
  application_version: string;
};

type TDatabasePreflightResult =
  | Readonly<{ status: 'empty' }>
  | Readonly<{ status: 'ready'; migration: TMigrationLedgerRow }>;

export type {
  TDatabasePreflightResult,
  TMigration,
  TMigrationLedgerRow,
};
