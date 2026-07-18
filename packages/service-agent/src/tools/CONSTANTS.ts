import { ZVibecanvasJson } from '@vibecanvas/service-actor/core/vibecanvasjson.zod';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export const WIDGET_EDIT_SESSION_CUSTOM_ENTRY_TYPE = 'vibecanvas.widgetEditSession';
export const WIDGET_RESOURCE_SELECTION_CUSTOM_ENTRY_TYPE = 'vibecanvas.widgetResourceSelection';
export const WIDGET_DRAFT_RESOURCE_BINDING_SELECTION_CUSTOM_ENTRY_TYPE = 'vibecanvas.widgetDraftResourceBindingSelection';
export const WIDGET_DB_CHANGE_PROPOSAL_CUSTOM_ENTRY_TYPE = 'vibecanvas.widgetDbChangeProposal';

export const Z_VIBECANVAS_JSON = ZVibecanvasJson;

export const AJV = new Ajv({ allErrors: true, strict: false });
addFormats(AJV);

// Bash starts in the chat cwd but is not filesystem-isolated there. Pi's shell can
// traverse paths, spawn subprocesses, use inherited executable lookup, and access
// the network with the same authority as the Vibecanvas host process.
export const BASH_DEFAULT_TIMEOUT_SECONDS = 120;
export const BASH_MAX_TIMEOUT_SECONDS = 600;

export const AI_CHAT_TOOL_NAMES = [
  'vc_widget_list',
  'vc_widget_create',
  'vc_widget_validate',
  'read',
  'edit',
  'patch',
  'grep',
  'vc_resource_list',
  'vc_resource_inspect',
  'vc_resource_create',
  'vc_resource_update',
  'vc_resource_delete',
  'vc_resource_data_read',
  'vc_resource_data_write',
  'web_fetch',
  'bash',
] as const;
