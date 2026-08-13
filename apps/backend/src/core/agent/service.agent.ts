import { Context, type Effect } from 'effect';

export type TAgentConnectRequest = Readonly<{
  canvasId: string;
  widgetId: string;
  sessionId: string;
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

export class AgentProgramError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentProgramError';
    this.code = code;
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
