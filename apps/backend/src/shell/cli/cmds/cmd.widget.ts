import { createHash, randomUUID } from 'node:crypto';
import { link, open, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Json } from 'effect/Schema';
import type { ICliConfig } from '../config';
import { createWidgetRpcConnection } from '../runtime/WidgetRpcConnection';
import { fnCanvasWebSocketUrl } from '../runtime/fn.canvas-websocket-url';
import {
  fnPrintCommandError,
  fnPrintCommandResult,
} from '../runtime/print-command-result';
import { fnValidatePreviewInspectionPng } from '../../preview/fn.png';
import type { TWidgetAuthoringValidationResult } from '../../widget-authoring/interface';
import { SCREENSHOT_LEASE_OPERATION_HEADER } from '../../widget-authoring/WidgetScreenshotLeaseService';
import { parseWidgetSubcommandArgs } from './widget-argv';
import {
  WIDGET_SUBCOMMANDS,
  type TParsedWidgetCommand,
  type TWidgetCliSubcommand,
} from './widget-interface';

const MAX_SCREENSHOT_BYTES = 16 * 1_024 * 1_024;
const WIDGET_SUBCOMMAND_SET = new Set<string>(WIDGET_SUBCOMMANDS);

const COMMON_HELP = `Common options:
  --port <number>              Running server RPC port (default: 3000)
  --data-dir <path>            Omnidraw home selection (default: ~/.omnidraw; env: OMNIDRAW_HOME)
  --json                       Emit one machine-readable result or error
  --help, -h                   Show this subcommand help`;

export const WIDGET_SUBCOMMAND_HELP = Object.freeze({
  list: `Usage: omnidraw widget list [--json] [--port <number>] [--data-dir <path>] [--help]

List the running server's current widget catalog.

${COMMON_HELP}`,
  resolve: `Usage: omnidraw widget resolve (--widget-key <slug> | --name <exact-name>) [--json]
  [--port <number>] [--data-dir <path>] [--help]

Resolve exactly one existing healthy draft and print its canonical key, path,
catalog generation, and source digest. Published-only widgets are rejected.

${COMMON_HELP}`,
  validate: `Usage: omnidraw widget validate --widget-key <slug> [--expected-draft-digest <sha256>] [--json]
  [--port <number>] [--data-dir <path>] [--help]

Validate source structure and run the accepted host artifact build. The result
reports source validation and host build evidence separately.

${COMMON_HELP}`,
  inspect: `Usage: omnidraw widget inspect --widget-key <slug> --expected-draft-digest <sha256> \\
  --expected-generation <number> --expected-build-identity <sha256> [options]

Options:
  --mode <artifact|preview>       Inspection surface (default: artifact)
  --canvas <id>                  Correlate preview mode to one exact Canvas
  --viewport <WxH[@1|2]>         Diagnostic viewport
  --settle-frames <number>       Stable animation frames (1-8)
  --settle-timeout <ms>          Settle timeout (100-10000)
  --actions <json|@file>         Up to 16 bounded diagnostic actions
  --continue-on-action-error     Continue after an action failure
  --timeout <ms>                 Whole-call timeout (1-180000)
  --screenshot <path>            Save verified PNG evidence atomically
  --overwrite                    Permit replacing the screenshot target

${COMMON_HELP}`,
} satisfies Readonly<Record<TWidgetCliSubcommand, string>>);

type TPublicCatalog = Readonly<{
  generation: number;
  catalogDigestSha256: string;
  healthy: boolean;
  entries: readonly Readonly<{
    widgetKey: string;
    health: string;
    draft: null | Readonly<{ config: null | Readonly<{ name: string }> }>;
    published: null | Readonly<{ config: null | Readonly<{ name: string }> }>;
  }>[];
}>;

type TInspectionResponse = Readonly<{
  ok: boolean;
  widgetKey: string;
  draftDigestSha256: string;
  acceptedGeneration: number;
  buildIdentity: string;
  canvasCorrelation: Readonly<{
    canvas: 'not_selected' | 'selected';
    visibleFrame: 'not_claimed';
    durableInstanceState: 'not_selected' | 'selected_not_exercised';
  }>;
  result?: Readonly<{
    status: string;
    screenshot?: Readonly<{
      mimeType: 'image/png';
      width: number;
      height: number;
      byteSize: number;
      digestSha256: string;
    }>;
    [key: string]: unknown;
  }>;
  error?: Readonly<{ code: string; message: string; retryable: boolean }>;
  screenshotLease?: Readonly<{ url: string; expiresAtMs: number }>;
}>;

function widgetCliError(code: string, message: string, hint?: string): Error {
  return Object.assign(new Error(message), {
    command: 'widget',
    code,
    ...(hint === undefined ? {} : { hint }),
  });
}

function safeWidgetCommandError(error: unknown): unknown {
  if (
    error !== null
    && typeof error === 'object'
    && 'code' in error
    && typeof error.code === 'string'
    && /^[A-Z][A-Z0-9_]{0,127}$/.test(error.code)
  ) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return widgetCliError('WIDGET_COMMAND_CANCELLED', 'Widget command was cancelled.');
  }
  return widgetCliError(
    'WIDGET_RPC_FAILED',
    'The running Omnidraw server could not complete the widget command.',
    'Check that the server is running on the selected loopback port, then resolve current state before retrying.',
  );
}

function printWidgetHelp(): void {
  console.log(`Usage: omnidraw widget <command> [options]

Commands:
  list       List current draft and published widget forms
  resolve    Resolve one exact existing healthy draft
  validate   Validate source and run the host artifact build
  inspect    Inspect one exact already-accepted build generation

Connection:
  Commands use the running server's Effect RPC at ws://127.0.0.1:<port>/rpc.
  Start it separately with 'omnidraw serve'. No command starts another backend.

Repair loop:
  resolve -> edit -> validate -> inspect artifact -> inspect preview

Security:
  OSS widget builds and server functions execute as trusted local host code.
  Inspection never approves protected writes or claims visible-frame parity.

Run 'omnidraw widget <command> --help' for exact arguments.`);
}

function humanValue(subcommand: TWidgetCliSubcommand, value: unknown): string {
  if (subcommand === 'list') {
    const catalog = value as TPublicCatalog;
    const lines = catalog.entries.map((entry) => {
      const name = entry.draft?.config?.name ?? entry.published?.config?.name ?? entry.widgetKey;
      const forms = [entry.draft === null ? null : 'draft', entry.published === null ? null : 'published']
        .filter(Boolean)
        .join('+');
      return `${entry.widgetKey}\t${name}\t${forms || 'none'}\t${entry.health}`;
    });
    return [
      `Catalog generation ${catalog.generation} (${catalog.catalogDigestSha256})`,
      ...lines,
    ].join('\n');
  }
  return JSON.stringify(value, null, 2);
}

export async function writeScreenshotAtomically(args: Readonly<{
  cwd: string;
  path: string;
  overwrite: boolean;
  bytes: Uint8Array;
}>): Promise<string> {
  const target = resolve(args.cwd, args.path);
  const temporary = `${target}.omnidraw-${randomUUID()}.tmp`;
  let temporaryPresent = false;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    temporaryPresent = true;
    try {
      await handle.writeFile(args.bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (args.overwrite) {
      await rename(temporary, target);
      temporaryPresent = false;
    } else {
      try {
        await link(temporary, target);
      } catch (error) {
        const code = error !== null && typeof error === 'object' && 'code' in error
          ? error.code
          : undefined;
        if (code === 'EEXIST') {
          throw widgetCliError(
            'WIDGET_SCREENSHOT_EXISTS',
            `Screenshot target already exists: ${target}`,
            'Pass --overwrite to replace it explicitly.',
          );
        }
        throw error;
      }
      await unlink(temporary);
      temporaryPresent = false;
    }
    return target;
  } finally {
    if (temporaryPresent) await unlink(temporary).catch(() => undefined);
  }
}

async function consumeScreenshotLease(args: Readonly<{
  config: ICliConfig;
  response: TInspectionResponse;
  path: string;
  overwrite: boolean;
  operationId: string;
  signal: AbortSignal;
}>): Promise<string> {
  const lease = args.response.screenshotLease;
  const metadata = args.response.result?.screenshot;
  if (lease === undefined || metadata === undefined) {
    throw widgetCliError(
      'WIDGET_SCREENSHOT_UNAVAILABLE',
      'Inspection did not return validated screenshot evidence.',
    );
  }
  const url = new URL(lease.url);
  if (
    url.protocol !== 'http:'
    || url.hostname !== '127.0.0.1'
    || Number(url.port || '80') !== args.config.port
    || lease.expiresAtMs <= Date.now()
  ) throw widgetCliError('WIDGET_SCREENSHOT_LEASE_INVALID', 'Screenshot lease authority is invalid or expired.');
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      [SCREENSHOT_LEASE_OPERATION_HEADER]: args.operationId,
    },
    cache: 'no-store',
    redirect: 'error',
    signal: args.signal,
  });
  if (!response.ok || response.headers.get('content-type') !== 'image/png') {
    throw widgetCliError('WIDGET_SCREENSHOT_FETCH_FAILED', 'Screenshot evidence could not be fetched safely.');
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (
    !Number.isSafeInteger(declaredLength)
    || declaredLength < 1
    || declaredLength > MAX_SCREENSHOT_BYTES
    || declaredLength !== metadata.byteSize
  ) throw widgetCliError('WIDGET_SCREENSHOT_LENGTH_INVALID', 'Screenshot byte length is invalid.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== declaredLength) {
    throw widgetCliError('WIDGET_SCREENSHOT_LENGTH_INVALID', 'Screenshot transfer was incomplete.');
  }
  const validation = fnValidatePreviewInspectionPng({
    bytes,
    expectedWidth: metadata.width,
    expectedHeight: metadata.height,
  });
  const digestSha256 = createHash('sha256').update(bytes).digest('hex');
  if (
    metadata.mimeType !== 'image/png'
    || !validation.ok
    || validation.byteSize !== metadata.byteSize
    || digestSha256 !== metadata.digestSha256
  ) throw widgetCliError('WIDGET_SCREENSHOT_INVALID', 'Screenshot bytes failed PNG evidence validation.');
  return await writeScreenshotAtomically({
    cwd: args.config.cwd,
    path: args.path,
    overwrite: args.overwrite,
    bytes,
  });
}

export async function runWidgetCommand(args: Readonly<{ config: ICliConfig }>): Promise<void> {
  const { config } = args;
  const wantsJson = config.subcommandOptions?.json === true;
  const subcommand = config.subcommand;
  if (subcommand === undefined) {
    printWidgetHelp();
    return;
  }
  if (!WIDGET_SUBCOMMAND_SET.has(subcommand)) {
    fnPrintCommandError(widgetCliError(
      'WIDGET_COMMAND_UNKNOWN',
      `Unknown widget command '${subcommand}'.`,
      `Available commands: ${WIDGET_SUBCOMMANDS.join(', ')}.`,
    ), wantsJson);
    if (!wantsJson) printWidgetHelp();
    return;
  }
  const exactSubcommand = subcommand as TWidgetCliSubcommand;
  if (config.helpRequested) {
    console.log(WIDGET_SUBCOMMAND_HELP[exactSubcommand]);
    return;
  }

  const controller = new AbortController();
  const interrupt = (): void => controller.abort('cli-interrupted');
  process.once('SIGINT', interrupt);
  let connection: ReturnType<typeof createWidgetRpcConnection> | undefined;
  try {
    const parsed = await parseWidgetSubcommandArgs(
      exactSubcommand,
      config.rawArgv.slice(4),
      randomUUID,
    );
    connection = createWidgetRpcConnection(fnCanvasWebSocketUrl(config.port));
    let result: unknown;
    if (parsed.subcommand === 'list') {
      result = await connection.request<TPublicCatalog>({
        path: 'widget.catalog.get',
        input: null,
        signal: controller.signal,
      });
    } else if (parsed.subcommand === 'resolve') {
      result = await connection.request({
        path: 'widget.authoring.resolve',
        input: parsed.input as Json,
        signal: controller.signal,
      });
    } else if (parsed.subcommand === 'validate') {
      result = await connection.request<TWidgetAuthoringValidationResult>({
        path: 'widget.authoring.validate',
        input: parsed.input as Json,
        signal: controller.signal,
      });
    } else {
      const response = await connection.request<TInspectionResponse>({
        path: 'widget.authoring.inspect',
        input: parsed.input,
        signal: controller.signal,
      });
      const hasScreenshotEvidence = response.screenshotLease !== undefined
        && response.result?.screenshot !== undefined;
      if (parsed.screenshotPath !== undefined && response.ok && !hasScreenshotEvidence) {
        throw widgetCliError(
          'WIDGET_SCREENSHOT_UNAVAILABLE',
          'Successful inspection did not return the requested screenshot evidence.',
        );
      }
      const screenshotPath = parsed.screenshotPath === undefined || !hasScreenshotEvidence
        ? undefined
        : await consumeScreenshotLease({
            config,
            response,
            path: parsed.screenshotPath,
            overwrite: parsed.overwrite,
            operationId: parsed.input.operationId,
            signal: controller.signal,
          });
      const { screenshotLease: _screenshotLease, ...safeResponse } = response;
      result = screenshotPath === undefined
        ? safeResponse
        : { ...safeResponse, screenshotPath };
    }
    const successful = result !== null
      && typeof result === 'object'
      && 'ok' in result
      && typeof result.ok === 'boolean'
      ? result.ok
      : true;
    fnPrintCommandResult(
      wantsJson ? result : humanValue(parsed.subcommand, result),
      wantsJson,
    );
    if (!successful) process.exitCode = 1;
  } catch (error) {
    fnPrintCommandError(
      controller.signal.aborted
        ? widgetCliError('WIDGET_COMMAND_CANCELLED', 'Widget command was cancelled.')
        : safeWidgetCommandError(error),
      wantsJson,
    );
  } finally {
    process.removeListener('SIGINT', interrupt);
    if (connection !== undefined) await connection.close();
  }
}
