import { ZWidgetManifestV1 } from '#backend/core/widget-domain';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
export {
  OMNIDRAW_CAPSULE_AUTHORING_APIS,
} from '#backend/shell/widget-runtime/contract';

export { WIDGET_DB_CHANGE_PROPOSAL_CUSTOM_ENTRY_TYPE } from '../../../core/agent/CONSTANTS';
export const TOOL_ERROR_DETAILS_MARKER = Symbol('omnidraw.toolError');

export const Z_OMNIDRAW_JSON = ZWidgetManifestV1;

export const AJV = new Ajv({ allErrors: true, strict: false });
addFormats(AJV);

// Bash starts in the chat workspace but is not filesystem-isolated there. The
// host child can traverse paths, spawn subprocesses, use inherited executable
// lookup, and access the network with the Omnidraw host process's authority.
export const BASH_DEFAULT_TIMEOUT_SECONDS = 120;
export const BASH_MAX_TIMEOUT_SECONDS = 600;

export const AI_CHAT_TOOL_NAMES = [
  'od_widget_list',
  'od_widget_create',
  'od_widget_validate',
  'od_widget_preview_inspect',
  'read',
  'edit',
  'patch',
  'grep',
  'od_resource_list',
  'od_resource_inspect',
  'od_resource_create',
  'od_resource_update',
  'od_resource_delete',
  'od_resource_data_read',
  'od_resource_data_write',
  'web_fetch',
  'bash',
] as const;
