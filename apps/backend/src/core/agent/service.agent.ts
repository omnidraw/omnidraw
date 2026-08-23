import { Context, Schema, type Effect } from 'effect';
import {
  attachSemanticFailureCause,
  EMPTY_SEMANTIC_FAILURE_DETAILS,
  SemanticFailureDetails,
  type TSemanticFailureDetails,
  type TSemanticFailureFields,
} from '../semantic-failure';

export type TAgentConnectRequest = Readonly<{
  canvasId: string;
  widgetId: string;
  sessionId: string;
  approvalPolicy:
    | Readonly<{ mode: 'always-approve' | 'manual' }>
    | Readonly<{
        mode: 'ai-review';
        reviewerModel: Readonly<{ provider: string; modelId: string }>;
      }>;
  mode?: 'reuse' | 'replace';
}>;

export type TAgentHistoryRequest = Readonly<{
  widgetId: string;
  sessionId: string;
}>;

export type TAgentHistoryEntry = Readonly<{
  entryId: string;
  message: unknown;
}>;

export type TAgentConnection = Readonly<{
  vcJson: unknown | null;
  messageHistory: readonly TAgentHistoryEntry[];
}>;

export const AGENT_PROGRAM_ERROR_CODES = Object.freeze([
  'AGENT_UNAVAILABLE',
  'CHAT_BUSY',
  'CHAT_CANVAS_CONFLICT',
  'CHAT_CANVAS_INVALID',
  'CHAT_CANVAS_REQUIRED',
  'CHAT_CANVAS_DELETING',
  'CHAT_CONNECTION_SUPERSEDED',
  'CHAT_EDIT_EMPTY',
  'CHAT_EDIT_TARGET_INVALID',
  'CHAT_REPLACEMENT_INCOMPLETE',
  'CHAT_SCOPE_INVALID',
  'CHAT_SERVICE_STOPPING',
  'WIDGET_REFERENCE_AMBIGUOUS',
] as const);

export type TAgentProgramErrorCode = typeof AGENT_PROGRAM_ERROR_CODES[number];

export class AgentProgramError extends Schema.TaggedError<AgentProgramError>()(
  'AgentProgramError',
  {
    code: Schema.Literals(AGENT_PROGRAM_ERROR_CODES),
    message: Schema.String,
    details: SemanticFailureDetails,
  },
) {
  constructor(
    codeOrFields: TAgentProgramErrorCode | TSemanticFailureFields<TAgentProgramErrorCode>,
    message?: string,
    details: TSemanticFailureDetails = EMPTY_SEMANTIC_FAILURE_DETAILS,
    options?: ErrorOptions,
  ) {
    super(typeof codeOrFields === 'string'
      ? { code: codeOrFields, message: message ?? codeOrFields, details }
      : codeOrFields);
    attachSemanticFailureCause(this, options?.cause);
  }
}

export interface IAgentAuthority {
  readonly connect: (
    args: TAgentConnectRequest,
  ) => Effect.Effect<TAgentConnection, AgentProgramError>;
  readonly history: (
    args: TAgentHistoryRequest,
  ) => Effect.Effect<readonly TAgentHistoryEntry[], AgentProgramError>;
}

export class AgentAuthority extends Context.Service<AgentAuthority, IAgentAuthority>()(
  'omnidraw/backend/AgentAuthority',
) {}
