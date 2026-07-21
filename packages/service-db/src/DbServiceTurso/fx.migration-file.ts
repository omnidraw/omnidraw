type TPortal = {
  Bun: Pick<typeof Bun, 'CryptoHasher' | 'file'>;
  TextDecoder: typeof TextDecoder;
};

type TArgs = {
  path: string;
};

type TMigrationFile = Readonly<{
  checksumSha256: string;
  sql: string;
}>;

async function fxReadMigrationFile(portal: TPortal, args: TArgs): Promise<TMigrationFile> {
  const file = portal.Bun.file(args.path);
  const bytes = await file.arrayBuffer();
  const exactBytes = new Uint8Array(bytes);
  const checksumSha256 = new portal.Bun.CryptoHasher('sha256')
    .update(exactBytes)
    .digest('hex');
  const sql = new portal.TextDecoder('utf-8', { fatal: true }).decode(exactBytes);

  return { checksumSha256, sql };
}

export { fxReadMigrationFile };
export type { TMigrationFile };
