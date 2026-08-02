import { ZWidgetManifestV3 } from '@omnidraw/widget-contract';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
export {
  OMNIDRAW_CAPSULE_AUTHORING_APIS,
} from '@omnidraw/capsule-omnidraw/contract';

export const WIDGET_EDIT_SESSION_CUSTOM_ENTRY_TYPE = 'omnidraw.widgetEditSession';
export const WIDGET_RESOURCE_SELECTION_CUSTOM_ENTRY_TYPE = 'omnidraw.widgetResourceSelection';
export const WIDGET_DRAFT_RESOURCE_BINDING_SELECTION_CUSTOM_ENTRY_TYPE = 'omnidraw.widgetDraftResourceBindingSelection';
export const WIDGET_DB_CHANGE_PROPOSAL_CUSTOM_ENTRY_TYPE = 'omnidraw.widgetDbChangeProposal';
export const TOOL_ERROR_DETAILS_MARKER = Symbol('omnidraw.toolError');

export const Z_OMNIDRAW_JSON = ZWidgetManifestV3;

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
  'vc_widget_preview_status',
  'vc_widget_preview_wait',
  'vc_widget_preview_test',
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
