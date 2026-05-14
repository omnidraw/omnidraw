import { baseFilesystemOs } from './orpc';

const apiListRegisteredFilesystems = baseFilesystemOs.listRegisteredFilesystems.handler(async ({ context }) => {
  return context.db.filesystem.listAll({ accountId: context.accountId });
});

export { apiListRegisteredFilesystems };
