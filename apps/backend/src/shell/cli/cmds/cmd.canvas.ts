import type { ICliConfig } from '../config';
import { createCanvasRpcConnection } from '../runtime/CanvasRpcConnection';
import { fnCanvasWebSocketUrl } from '../runtime/fn.canvas-websocket-url';
import {
  fnBuildUnknownCanvasCommandError,
  fnPrintCommandError,
  fnPrintCommandResult,
} from '../runtime/print-command-result';
import { parseCanvasSubcommandArgs } from './canvas-argv';
import { runCanvasAddCommand } from './cmd.add.canvas';
import { CANVAS_SUBCOMMANDS } from './CONSTANTS';
import { runCanvasDeleteCommand } from './cmd.delete.canvas';
import { runCanvasGroupCommand } from './cmd.group.canvas';
import { runCanvasListCommand } from './cmd.list.canvas';
import { runCanvasMoveCommand } from './cmd.move.canvas';
import { runCanvasPatchCommand } from './cmd.patch.canvas';
import { runCanvasQueryCommand } from './cmd.query.canvas';
import { runCanvasReorderCommand } from './cmd.reorder.canvas';
import { runCanvasUngroupCommand } from './cmd.ungroup.canvas';
import type {
  ICanvasRpcConnection,
  TCanvasCliOutput,
  TCanvasCliSubcommand,
  TParsedCanvasCommand,
} from './interface';

type TCanvasCliShell = Readonly<{
  connect(websocketUrl: string): ICanvasRpcConnection;
  createCommandId(): string;
}>;

type TArgs = Readonly<{
  config: ICliConfig;
}>;

const CANVAS_SUBCOMMAND_SET = new Set<string>(CANVAS_SUBCOMMANDS);

const HELP = Object.freeze({
  list: `Usage: omnidraw canvas list [--json] [--port <number>]

List canvases visible through the running server.`,
  query: `Usage: omnidraw canvas query (--canvas <id> | --canvas-name <query>) [filter] [options]

Filters (choose at most one):
  --id <id>                 Exact item id; repeat or comma-separate
  --kind <kind>             Exact Cangine node kind
  --parent <id|root>        Direct parent id, or root for top-level items
  --widget-instance <id>    Exact widget instance id
  --widget-key <slug>       Exact filesystem widget key

Pagination:
  --limit <number>
  --cursor <json>`,
  add: `Usage: omnidraw canvas add (--canvas <id> | --canvas-name <query>) --item <json>... [--dry-run]

--item accepts a full authored Cangine node or an array of nodes. Node ids,
parentId, orderKey, kind, transform, geometry, and extensions are preserved.`,
  patch: `Usage: omnidraw canvas patch (--canvas <id> | --canvas-name <query>) --id <id>... --patch <json> [--dry-run]

Patch JSON is one patch or an array:
  {"type":"set","path":["transform","position","x"],"value":120}
  {"type":"remove","path":["extensions","example:key"]}`,
  move: `Usage: omnidraw canvas move (--canvas <id> | --canvas-name <query>) --id <id>... (--absolute | --relative) [--x <number>] [--y <number>] [--dry-run]

Move emits guarded JSON-path patches for Cangine transform.position.`,
  group: `Usage: omnidraw canvas group (--canvas <id> | --canvas-name <query>) --id <id>... [--group-id <id>] [--dry-run]

Targets must share one parent. The command atomically inserts an identity
Cangine group and reparents all targets. A group id is generated when omitted.`,
  ungroup: `Usage: omnidraw canvas ungroup (--canvas <id> | --canvas-name <query>) --id <group-id> [--dry-run]

Direct children are atomically reparented to the group's parent before the
group node is deleted.`,
  reorder: `Usage: omnidraw canvas reorder (--canvas <id> | --canvas-name <query>) --id <id> --order-key <key> [--dry-run]

The explicit persisted Cangine orderKey replaces client-side z-index actions.`,
  delete: `Usage: omnidraw canvas delete (--canvas <id> | --canvas-name <query>) --id <id>... [--dry-run]

Deleting a group includes every descendant in the same guarded command.`,
} satisfies Readonly<Record<TCanvasCliSubcommand, string>>);

export function printCanvasHelp(): void {
  console.log(`Usage: omnidraw canvas <command> [options]

Commands:
  list       List accessible canvases
  query      Query authoritative Cangine canvas items
  add        Insert complete Cangine nodes
  patch      Apply guarded JSON-path patches
  move       Move node transforms
  group      Insert a group and reparent nodes atomically
  ungroup    Reparent children and delete a group atomically
  reorder    Set one exact Cangine orderKey
  delete     Delete nodes and group descendants atomically

Connection:
  Commands use Effect RPC at ws://127.0.0.1:<port>/rpc.
  Start the server separately with 'omnidraw serve'.

Shared options:
  --port <number>   Server port (default: 7496)
  --json            Emit one machine-readable JSON result
  --dry-run         Fetch current state and print the command without executing it
  --help, -h        Show command-specific help

Run 'omnidraw canvas <command> --help' for exact arguments.`);
}

export function printCanvasCommandHelp(subcommand: TCanvasCliSubcommand): void {
  console.log(`${HELP[subcommand]}\n
Shared options:
  --port <number>  Running Omnidraw server port
  --json           Emit machine-readable output
  --help, -h       Show this help`);
}

async function dispatchCanvasCommand(
  parsed: TParsedCanvasCommand,
  connection: ICanvasRpcConnection,
  createCommandId: () => string,
): Promise<TCanvasCliOutput> {
  if (parsed.subcommand === 'list') {
    return await runCanvasListCommand(connection.api);
  }
  if (parsed.subcommand === 'query') {
    return await runCanvasQueryCommand(connection.api, parsed.input);
  }
  if (parsed.subcommand === 'add') {
    return await runCanvasAddCommand(connection.api, parsed.input, createCommandId);
  }
  if (parsed.subcommand === 'patch') {
    return await runCanvasPatchCommand(connection.api, parsed.input, createCommandId);
  }
  if (parsed.subcommand === 'move') {
    return await runCanvasMoveCommand(connection.api, parsed.input, createCommandId);
  }
  if (parsed.subcommand === 'group') {
    return await runCanvasGroupCommand(connection.api, parsed.input, createCommandId);
  }
  if (parsed.subcommand === 'ungroup') {
    return await runCanvasUngroupCommand(connection.api, parsed.input, createCommandId);
  }
  if (parsed.subcommand === 'reorder') {
    return await runCanvasReorderCommand(connection.api, parsed.input, createCommandId);
  }
  return await runCanvasDeleteCommand(connection.api, parsed.input, createCommandId);
}

export async function runCanvasCommand(
  args: TArgs & Readonly<{ shell: TCanvasCliShell }>,
): Promise<void> {
  const { config, shell } = args;
  const wantsJson = config.subcommandOptions?.json === true;
  const subcommand = config.subcommand;
  if (subcommand === undefined) {
    printCanvasHelp();
    return;
  }
  if (!CANVAS_SUBCOMMAND_SET.has(subcommand)) {
    fnPrintCommandError(
      fnBuildUnknownCanvasCommandError(subcommand),
      wantsJson,
    );
    if (!wantsJson) printCanvasHelp();
    return;
  }
  if (config.helpRequested) {
    printCanvasCommandHelp(subcommand as TCanvasCliSubcommand);
    return;
  }

  let connection: ICanvasRpcConnection | undefined;
  try {
    const parsed = parseCanvasSubcommandArgs(
      subcommand as TCanvasCliSubcommand,
      config.rawArgv.slice(4),
    );
    connection = shell.connect(fnCanvasWebSocketUrl(config.port));
    const output = await dispatchCanvasCommand(
      parsed,
      connection,
      shell.createCommandId,
    );
    fnPrintCommandResult(wantsJson ? output.payload : output.text, wantsJson);
  } catch (error) {
    fnPrintCommandError(error, wantsJson);
  } finally {
    if (connection !== undefined) await connection.close();
  }
}

export const DEFAULT_CANVAS_CLI_SHELL: TCanvasCliShell = Object.freeze({
  connect: createCanvasRpcConnection,
  createCommandId: () => crypto.randomUUID(),
});
