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
  applied_at_sec: string;
  application_version: string;
};

type TMigrationChecksum = Readonly<{
  version: number;
  name: string;
  checksumSha256: string;
}>;

type TDatabasePreflightResult =
  | Readonly<{ status: 'empty' }>
  | Readonly<{
      status: 'ready';
      currentVersion: number;
      appliedMigrations: readonly TMigrationLedgerRow[];
    }>;

export type {
  TDatabasePreflightResult,
  TMigration,
  TMigrationChecksum,
  TMigrationLedgerRow,
};
