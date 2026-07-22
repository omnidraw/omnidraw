import {
  defineTool,
  type AgentToolResult,
  type AgentToolUpdateCallback,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { BASH_DEFAULT_TIMEOUT_SECONDS, BASH_MAX_TIMEOUT_SECONDS } from './CONSTANTS';
import { fnToolError } from './fn.result';
import type { TToolDefinition } from './types';

type TCreateBashToolArgs = {
  authorize: () => Promise<boolean>;
  capability?: TAgentBashCapability;
};

export type TAgentBashRunArgs = Readonly<{
  toolCallId: string;
  command: string;
  timeoutSeconds: number;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback<unknown>;
  context?: ExtensionContext;
}>;

/** Host-provided, pre-confined command runner. */
export type TAgentBashCapability = Readonly<{
  run(args: TAgentBashRunArgs): AgentToolResult<unknown> | Promise<AgentToolResult<unknown>>;
}>;

export function createBashTool(args: TCreateBashToolArgs): TToolDefinition {
  return defineTool({
    name: 'bash',
    label: 'Bash',
    description: `Execute a command through the host-provided confined bash capability. Defaults to ${BASH_DEFAULT_TIMEOUT_SECONDS} seconds and accepts at most ${BASH_MAX_TIMEOUT_SECONDS} seconds. Use structured read, edit, patch, and grep for normal mounted-widget changes.`,
    parameters: Type.Object({
      command: Type.String({ minLength: 1, description: 'Bash command to execute.' }),
      timeout: Type.Optional(Type.Number({
        exclusiveMinimum: 0,
        maximum: BASH_MAX_TIMEOUT_SECONDS,
        description: `Timeout in seconds. Defaults to ${BASH_DEFAULT_TIMEOUT_SECONDS}; maximum ${BASH_MAX_TIMEOUT_SECONDS}.`,
      })),
    }, { additionalProperties: false }),
    async execute(toolCallId: string, params: any, signal?: AbortSignal, onUpdate?: any, context?: any) {
      if (!await args.authorize()) {
        return fnToolError({ code: 'TOOL_NOT_AUTHORIZED', message: 'This tool call is not authorized.' });
      }
      const timeout = params.timeout ?? BASH_DEFAULT_TIMEOUT_SECONDS;
      if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0 || timeout > BASH_MAX_TIMEOUT_SECONDS) {
        return fnToolError({
          code: 'BASH_TIMEOUT_INVALID',
          message: `Bash timeout must be greater than 0 and no more than ${BASH_MAX_TIMEOUT_SECONDS} seconds.`,
        });
      }
      if (!args.capability) {
        return fnToolError({
          code: 'BASH_UNAVAILABLE',
          message: 'Bash is unavailable because this host did not provide a confined command capability.',
        });
      }
      return args.capability.run({
        toolCallId,
        command: params.command,
        timeoutSeconds: timeout,
        signal,
        onUpdate,
        context,
      });
    },
  }) as TToolDefinition;
}
