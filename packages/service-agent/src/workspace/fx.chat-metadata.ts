export type TPortal = {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
};

export type TArgs = {
  metadataPath: string;
};

export async function fxReadChatMetadata(portal: TPortal, args: TArgs): Promise<unknown> {
  return JSON.parse(await portal.readFile(args.metadataPath, 'utf8')) as unknown;
}
