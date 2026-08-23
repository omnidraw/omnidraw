export type TEffects = {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
};

export type TArgs = {
  metadataPath: string;
};

export async function readChatMetadata(effects: TEffects, args: TArgs): Promise<unknown> {
  return JSON.parse(await effects.readFile(args.metadataPath, 'utf8')) as unknown;
}
