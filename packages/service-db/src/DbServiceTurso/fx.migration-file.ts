type TPortal = {
  Bun: Pick<typeof Bun, 'CryptoHasher' | 'file'>;
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
  const [bytes, sql] = await Promise.all([
    file.arrayBuffer(),
    file.text(),
  ]);
  const checksumSha256 = new portal.Bun.CryptoHasher('sha256')
    .update(new Uint8Array(bytes))
    .digest('hex');

  return { checksumSha256, sql };
}

export { fxReadMigrationFile };
export type { TMigrationFile };
