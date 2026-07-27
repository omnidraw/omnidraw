import type { ICliConfig } from '../../../config';
import { createCanvasRpcConnection } from '../core/CanvasRpcConnection';
import { fnCanvasWebSocketUrl } from '../core/fn.canvas-websocket-url';
import {
  fnBuildUnknownCanvasCommandError,
  fnPrintCommandError,
  fnPrintCommandResult,
} from '../core/fn.print-command-result';
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

type TPortal = Readonly<{
  connect(websocketUrl: string): ICanvasRpcConnection;
  createCommandId(): string;
}>;

type TArgs = Readonly<{
  config: ICliConfig;
}>;

const CANVAS_SUBCOMMAND_SET = new Set<string>(CANVAS_SUBCOMMANDS);

const HELP = Object.freeze({
  list: `Usage: vibecanvas canvas list [--json] [--port <number>]

List canvases visible through the running server.`,
  query: `Usage: vibecanvas canvas query (--canvas <id> | --canvas-name <query>) [filter] [options]

Filters (choose at most one):
  --id <id>                 Exact item id; repeat or comma-separate
  --kind <kind>             Exact Cangine node kind
  --parent <id|root>        Direct parent id, or root for top-level items
  --widget-instance <id>    Exact widget instance id
  --widget-definition <id>  Exact widget definition id
  --revision <id>           Optional revision with --widget-definition

Pagination:
  --limit <number>
  --cursor <json>`,
  add: `Usage: vibecanvas canvas add (--canvas <id> | --canvas-name <query>) --item <json>... [--dry-run]

--item accepts a full authored Cangine node or an array of nodes. Node ids,
parentId, orderKey, kind, transform, geometry, and extensions are preserved.`,
  patch: `Usage: vibecanvas canvas patch (--canvas <id> | --canvas-name <query>) --id <id>... --patch <json> [--dry-run]

Patch JSON is one patch or an array:
  {"type":"set","path":["transform","position","x"],"value":120}
  {"type":"remove","path":["extensions","example:key"]}`,
  move: `Usage: vibecanvas canvas move (--canvas <id> | --canvas-name <query>) --id <id>... (--absolute | --relative) [--x <number>] [--y <number>] [--dry-run]

Move emits guarded JSON-path patches for Cangine transform.position.`,
  group: `Usage: vibecanvas canvas group (--canvas <id> | --canvas-name <query>) --id <id>... [--group-id <id>] [--dry-run]

Targets must share one parent. The command atomically inserts an identity
Cangine group and reparents all targets. A group id is generated when omitted.`,
  ungroup: `Usage: vibecanvas canvas ungroup (--canvas <id> | --canvas-name <query>) --id <group-id> [--dry-run]

Direct children are atomically reparented to the group's parent before the
group node is deleted.`,
  reorder: `Usage: vibecanvas canvas reorder (--canvas <id> | --canvas-name <query>) --id <id> --order-key <key> [--dry-run]

The explicit persisted Cangine orderKey replaces client-side z-index actions.`,
  delete: `Usage: vibecanvas canvas delete (--canvas <id> | --canvas-name <query>) --id <id>... [--dry-run]

Deleting a group includes every descendant in the same guarded command.`,
} satisfies Readonly<Record<TCanvasCliSubcommand, string>>);

export function printCanvasHelp(): void {
  console.log(`Usage: vibecanvas canvas <command> [options]

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
  Commands use WebSocket oRPC at ws://127.0.0.1:<port>/api.
  Start the server separately with 'vibecanvas serve'.

Shared options:
  --port <number>   Server port (default: 3000 dev, 7496 compiled)
  --json            Emit one machine-readable JSON result
  --dry-run         Fetch current state and print the command without executing it
  --help, -h        Show command-specific help

Run 'vibecanvas canvas <command> --help' for exact arguments.`);
}

export function printCanvasCommandHelp(subcommand: TCanvasCliSubcommand): void {
  console.log(`${HELP[subcommand]}\n
Shared options:
  --port <number>  Running Vibecanvas server port
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

export async function txCmdCanvas(
  portal: TPortal,
  args: TArgs,
): Promise<void> {
  const { config } = args;
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
    connection = portal.connect(fnCanvasWebSocketUrl(config.port));
    const output = await dispatchCanvasCommand(
      parsed,
      connection,
      portal.createCommandId,
    );
    fnPrintCommandResult(wantsJson ? output.payload : output.text, wantsJson);
  } catch (error) {
    fnPrintCommandError(error, wantsJson);
  } finally {
    connection?.close();
  }
}

export const DEFAULT_CANVAS_CLI_PORTAL: TPortal = Object.freeze({
  connect: createCanvasRpcConnection,
  createCommandId: () => crypto.randomUUID(),
});
