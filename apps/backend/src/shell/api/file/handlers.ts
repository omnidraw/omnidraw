import { apiCloneFile } from './api.clone-file';
import { apiPutFile } from './api.put-file';
import { apiRemoveFile } from './api.remove-file';
import { baseFileOs } from './procedure-builder';

const fileHandlers = {
  put: apiPutFile,
  clone: apiCloneFile,
  remove: apiRemoveFile,
};

export { baseFileOs, fileHandlers };
