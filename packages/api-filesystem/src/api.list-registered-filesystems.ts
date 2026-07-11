import { baseFilesystemOs } from './orpc';

const apiListRegisteredFilesystems = baseFilesystemOs.listRegisteredFilesystems.handler(async ({ context }) => {
  return await context.db.filesystem.listAll();
});

export { apiListRegisteredFilesystems };
