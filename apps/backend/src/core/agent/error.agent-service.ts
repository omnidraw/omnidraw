import {
  AgentProgramError,
  type TAgentProgramErrorCode,
} from './service.agent';

export type TAgentServiceErrorCode = Extract<TAgentProgramErrorCode,
  | 'CHAT_BUSY'
  | 'CHAT_CANVAS_CONFLICT'
  | 'CHAT_CANVAS_INVALID'
  | 'CHAT_CANVAS_REQUIRED'
  | 'CHAT_CONNECTION_SUPERSEDED'
  | 'CHAT_EDIT_EMPTY'
  | 'CHAT_EDIT_TARGET_INVALID'
  | 'CHAT_REPLACEMENT_INCOMPLETE'
  | 'CHAT_SCOPE_INVALID'
  | 'CHAT_SERVICE_STOPPING'
  | 'WIDGET_REFERENCE_AMBIGUOUS'>;

/** Compatibility name for the single feature-owned agent semantic failure. */
export const AgentServiceError = AgentProgramError;
export type AgentServiceError = AgentProgramError;
