type TEffects = {
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

async function readMigrationFile(effects: TEffects, args: TArgs): Promise<TMigrationFile> {
  const file = effects.Bun.file(args.path);
  const bytes = await file.arrayBuffer();
  const exactBytes = new Uint8Array(bytes);
  const checksumSha256 = new effects.Bun.CryptoHasher('sha256')
    .update(exactBytes)
    .digest('hex');
  const sql = new effects.TextDecoder('utf-8', { fatal: true }).decode(exactBytes);

  return { checksumSha256, sql };
}

export { readMigrationFile };
export type { TMigrationFile };
