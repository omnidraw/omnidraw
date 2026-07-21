import { apiCreatePty } from './api.create-pty';
import { apiGetPty } from './api.get-pty';
import { apiListPty } from './api.list-pty';
import { apiRemovePty } from './api.remove-pty';
import { apiUpdatePty } from './api.update-pty';
import { apiUploadPtyImage } from './api.upload-image';
import { basePtyOs } from './orpc';

const ptyHandlers = {
  list: apiListPty,
  create: apiCreatePty,
  get: apiGetPty,
  update: apiUpdatePty,
  remove: apiRemovePty,
  uploadImage: apiUploadPtyImage,
};

export { basePtyOs, ptyHandlers };
