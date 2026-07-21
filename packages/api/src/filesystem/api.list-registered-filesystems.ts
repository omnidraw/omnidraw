import { baseFilesystemOs } from './orpc';

const apiListRegisteredFilesystems = baseFilesystemOs.listRegisteredFilesystems.handler(async ({ context }) => {
  const filesystems = await context.db.filesystem.listAll(context.tenant);
  return filesystems.map((filesystem) => ({ ...filesystem, path: '' }));
});

export { apiListRegisteredFilesystems };
