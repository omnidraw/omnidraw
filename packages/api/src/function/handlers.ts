import { apiCancelFunction } from './api.cancel-function';
import { apiGetFunction } from './api.get-function';
import { apiInvokeFunction } from './api.invoke-function';

const functionHandlers = {
  invoke: apiInvokeFunction,
  get: apiGetFunction,
  cancel: apiCancelFunction,
};

export { functionHandlers };
