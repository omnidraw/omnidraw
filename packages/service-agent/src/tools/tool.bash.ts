import {
  defineTool,
  type AgentToolResult,
  type AgentToolUpdateCallback,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import { BASH_DEFAULT_TIMEOUT_SECONDS, BASH_MAX_TIMEOUT_SECONDS } from './CONSTANTS';
import { fnToolError } from './fn.result';
import type {
  TToolDefinition,
  TWidgetDraftChangeHandler,
} from './types';

type TCreateBashToolArgs = {
  authorize: () => Promise<boolean>;
  capability?: TAgentBashCapability;
  chatId: string;
  workspace: WidgetWorkspace;
  onDraftChanged?: TWidgetDraftChangeHandler;
};

export type TAgentBashRunArgs = Readonly<{
  toolCallId: string;
  command: string;
  timeoutSeconds: number;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback<unknown>;
  context?: ExtensionContext;
}>;

/**
 * Host-provided, pre-confined command runner.
 *
 * Implementations must confine the command to the chat workspace, prevent
 * direct access to the shared draft root, and prevent commands from replacing
 * chat mount entries. Mounted widget contents may remain writable; this tool
 * detects and durably fences those source changes after the command settles.
 */
export type TAgentBashCapability = Readonly<{
  run(args: TAgentBashRunArgs): AgentToolResult<unknown> | Promise<AgentToolResult<unknown>>;
}>;

const BASH_MUTATION_FENCE_MAX_MOUNTS = 64;

async function captureDraftRevisions(
  workspace: WidgetWorkspace,
  names: readonly string[],
): Promise<ReadonlyMap<string, string | null>> {
  return new Map(await Promise.all(names.map(async (name) => [
    name,
    (await workspace.getDraft(name))?.revision ?? null,
  ] as const)));
}

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
      try {
        const mounts = await args.workspace.listMounts(args.chatId);
        if (mounts.length > BASH_MUTATION_FENCE_MAX_MOUNTS) {
          return fnToolError({
            code: 'BASH_MUTATION_FENCE_LIMIT',
            message: `Bash can inspect at most ${BASH_MUTATION_FENCE_MAX_MOUNTS} mounted widget drafts per call.`,
          });
        }
        const names = mounts.map((mount) => mount.name);
        return await args.workspace.withDraftAuthoringOperations(names, async () => {
          const before = await captureDraftRevisions(args.workspace, names);
          let result: AgentToolResult<unknown> | undefined;
          let runError: unknown;
          let runFailed = false;
          try {
            result = await args.capability!.run({
              toolCallId,
              command: params.command,
              timeoutSeconds: timeout,
              signal,
              onUpdate,
              context,
            });
          } catch (error) {
            runFailed = true;
            runError = error;
          }
          const after = await captureDraftRevisions(args.workspace, names);
          const afterMountNames = (await args.workspace.inspectMounts(args.chatId))
            .map((mount) => mount.name);
          const changedNames = names.filter((name) => (
            before.get(name) !== after.get(name)
          ));
          const failures: unknown[] = [];
          for (const name of changedNames) {
            if (after.get(name) === null || args.onDraftChanged === undefined) {
              failures.push(new Error(
                `Bash changed widget source '${name}' without durable mutation-fence authority.`,
              ));
              continue;
            }
            try {
              const durable = await args.onDraftChanged({ name, type: 'changed' });
              if (durable) continue;
              failures.push(new Error(
                `Bash changed widget source '${name}' without receiving a durable mutation fence.`,
              ));
            } catch (error) {
              failures.push(error);
            }
          }
          if (
            afterMountNames.length !== names.length
            || afterMountNames.some((name, index) => name !== names[index])
          ) {
            const expectedNames = new Set(names);
            const currentNames = new Set(afterMountNames);
            await Promise.allSettled(names
              .filter((name) => !currentNames.has(name))
              .map((name) => args.workspace.loadWidget(args.chatId, name)));
            await Promise.allSettled(afterMountNames
              .filter((name) => !expectedNames.has(name))
              .map((name) => args.workspace.removeMount(args.chatId, name)));
            failures.push(new Error(
              'Bash changed the confined widget mount set; mount lifecycle changes require structured tools.',
            ));
          }
          if (runFailed) failures.push(runError);
          if (failures.length === 1) throw failures[0];
          if (failures.length > 1) {
            throw new AggregateError(
              failures,
              failures.map((failure) => (
                failure instanceof Error ? failure.message : String(failure)
              )).join(' '),
            );
          }
          return result!;
        });
      } catch (error) {
        return fnToolError({
          code: 'BASH_FAILED',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  }) as TToolDefinition;
}
