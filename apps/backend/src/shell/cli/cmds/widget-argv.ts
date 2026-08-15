import { readFile, stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { Json } from 'effect/Schema';
import type { TParsedWidgetCommand, TWidgetCliSubcommand } from './widget-interface';

type TOptionDefinition = Readonly<{
  type: 'boolean' | 'string';
  short?: string;
}>;
type TOptionValues = Readonly<Record<string, boolean | string | undefined>>;

const COMMON_OPTIONS = Object.freeze({
  help: { type: 'boolean', short: 'h' },
  json: { type: 'boolean' },
  port: { type: 'string' },
  'data-dir': { type: 'string' },
} satisfies Readonly<Record<string, TOptionDefinition>>);

function widgetArgvError(command: string, code: string, message: string): Error {
  return Object.assign(new Error(message), {
    command: `widget ${command}`,
    code,
    next: `Run 'omnidraw widget ${command} --help' for accepted options.`,
  });
}

function parseOptions(
  command: string,
  args: readonly string[],
  options: Readonly<Record<string, TOptionDefinition>>,
): TOptionValues {
  try {
    return parseArgs({
      args: [...args],
      allowPositionals: false,
      strict: true,
      options: { ...COMMON_OPTIONS, ...options },
    }).values as TOptionValues;
  } catch (error) {
    throw widgetArgvError(
      command,
      'WIDGET_ARGUMENT_INVALID',
      error instanceof Error ? error.message : String(error),
    );
  }
}

function stringValue(
  command: string,
  values: TOptionValues,
  key: string,
  required = false,
): string | undefined {
  const value = values[key];
  if (value === undefined) {
    if (required) throw widgetArgvError(
      command,
      'WIDGET_ARGUMENT_VALUE_REQUIRED',
      `--${key} requires a non-empty value.`,
    );
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw widgetArgvError(
      command,
      'WIDGET_ARGUMENT_VALUE_REQUIRED',
      `--${key} requires a non-empty value.`,
    );
  }
  return value.trim();
}

function positiveInteger(command: string, values: TOptionValues, key: string): number | undefined {
  const raw = stringValue(command, values, key);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw widgetArgvError(command, 'WIDGET_INTEGER_INVALID', `--${key} must be a positive integer.`);
  }
  return value;
}

function sha256Value(command: string, values: TOptionValues, key: string, required = false): string | undefined {
  const value = stringValue(command, values, key, required);
  if (value !== undefined && !/^[a-f0-9]{64}$/.test(value)) {
    throw widgetArgvError(
      command,
      'WIDGET_DIGEST_INVALID',
      `--${key} must be one lowercase SHA-256 digest.`,
    );
  }
  return value;
}

async function actionsValue(command: string, raw: string | undefined): Promise<Json | undefined> {
  if (raw === undefined) return undefined;
  let source = raw;
  if (raw.startsWith('@')) {
    const path = raw.slice(1);
    if (path.length === 0) {
      throw widgetArgvError(command, 'WIDGET_ACTIONS_PATH_REQUIRED', '--actions @file requires a path.');
    }
    const metadata = await stat(path).catch(() => null);
    if (metadata === null || !metadata.isFile() || metadata.size > 128 * 1_024) {
      throw widgetArgvError(
        command,
        'WIDGET_ACTIONS_FILE_INVALID',
        'The actions file must be a regular file no larger than 128 KiB.',
      );
    }
    source = await readFile(path, 'utf8');
  }
  if (Buffer.byteLength(source, 'utf8') > 128 * 1_024) {
    throw widgetArgvError(command, 'WIDGET_ACTIONS_TOO_LARGE', 'Actions JSON exceeds 128 KiB.');
  }
  try {
    const parsed = JSON.parse(source) as unknown;
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed as Json;
  } catch {
    throw widgetArgvError(command, 'WIDGET_ACTIONS_INVALID', '--actions must contain one JSON array.');
  }
}

function viewportValue(command: string, raw: string | undefined): Readonly<{
  width: number;
  height: number;
  deviceScaleFactor?: 1 | 2;
}> | undefined {
  if (raw === undefined) return undefined;
  const match = /^(\d+)x(\d+)(?:@(1|2))?$/.exec(raw);
  if (match === null) {
    throw widgetArgvError(
      command,
      'WIDGET_VIEWPORT_INVALID',
      '--viewport uses WIDTHxHEIGHT or WIDTHxHEIGHT@SCALE.',
    );
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 160 || width > 1_280 || height < 120 || height > 1_024) {
    throw widgetArgvError(
      command,
      'WIDGET_VIEWPORT_INVALID',
      'Viewport width must be 160–1280 and height 120–1024.',
    );
  }
  return {
    width,
    height,
    ...(match[3] === undefined ? {} : { deviceScaleFactor: Number(match[3]) as 1 | 2 }),
  };
}

export async function parseWidgetSubcommandArgs(
  subcommand: TWidgetCliSubcommand,
  args: readonly string[],
  createOperationId: () => string,
): Promise<TParsedWidgetCommand> {
  if (subcommand === 'list') {
    parseOptions(subcommand, args, {});
    return { subcommand, input: null };
  }
  if (subcommand === 'resolve') {
    const values = parseOptions(subcommand, args, {
      'widget-key': { type: 'string' },
      name: { type: 'string' },
    });
    const widgetKey = stringValue(subcommand, values, 'widget-key');
    const name = stringValue(subcommand, values, 'name');
    if ((widgetKey === undefined) === (name === undefined)) {
      throw widgetArgvError(
        subcommand,
        'WIDGET_SELECTOR_REQUIRED',
        'Choose exactly one selector: --widget-key <slug> or --name <exact-name>.',
      );
    }
    return {
      subcommand,
      input: widgetKey === undefined ? { name: name! } : { widgetKey },
    };
  }
  if (subcommand === 'validate') {
    const values = parseOptions(subcommand, args, {
      'widget-key': { type: 'string' },
      'expected-draft-digest': { type: 'string' },
    });
    const widgetKey = stringValue(subcommand, values, 'widget-key', true)!;
    const expectedDraftDigestSha256 = sha256Value(
      subcommand,
      values,
      'expected-draft-digest',
    );
    return {
      subcommand,
      input: {
        widgetKey,
        ...(expectedDraftDigestSha256 === undefined ? {} : { expectedDraftDigestSha256 }),
      },
    };
  }

  const values = parseOptions(subcommand, args, {
    'widget-key': { type: 'string' },
    'expected-draft-digest': { type: 'string' },
    'expected-generation': { type: 'string' },
    'expected-build-identity': { type: 'string' },
    mode: { type: 'string' },
    canvas: { type: 'string' },
    viewport: { type: 'string' },
    'settle-frames': { type: 'string' },
    'settle-timeout': { type: 'string' },
    actions: { type: 'string' },
    'continue-on-action-error': { type: 'boolean' },
    timeout: { type: 'string' },
    screenshot: { type: 'string' },
    overwrite: { type: 'boolean' },
  });
  const mode = stringValue(subcommand, values, 'mode') ?? 'artifact';
  if (mode !== 'artifact' && mode !== 'preview') {
    throw widgetArgvError(subcommand, 'WIDGET_MODE_INVALID', '--mode must be artifact or preview.');
  }
  const viewport = viewportValue(subcommand, stringValue(subcommand, values, 'viewport'));
  const settleFrames = positiveInteger(subcommand, values, 'settle-frames');
  const settleTimeoutMs = positiveInteger(subcommand, values, 'settle-timeout');
  const actions = await actionsValue(subcommand, stringValue(subcommand, values, 'actions'));
  const timeoutMs = positiveInteger(subcommand, values, 'timeout');
  const screenshotPath = stringValue(subcommand, values, 'screenshot');
  const canvasId = stringValue(subcommand, values, 'canvas');
  if (mode === 'artifact' && canvasId !== undefined) {
    throw widgetArgvError(
      subcommand,
      'WIDGET_CANVAS_MODE_INVALID',
      '--canvas is available only with --mode preview.',
    );
  }
  const input = {
    widgetKey: stringValue(subcommand, values, 'widget-key', true)!,
    expectedDraftDigestSha256: sha256Value(
      subcommand,
      values,
      'expected-draft-digest',
      true,
    )!,
    expectedAcceptedGeneration: positiveInteger(subcommand, values, 'expected-generation')
      ?? (() => { throw widgetArgvError(subcommand, 'WIDGET_GENERATION_REQUIRED', '--expected-generation is required.'); })(),
    expectedBuildIdentity: sha256Value(
      subcommand,
      values,
      'expected-build-identity',
      true,
    )!,
    mode,
    ...(canvasId === undefined ? {} : { canvasId }),
    ...(viewport === undefined ? {} : { viewport }),
    ...(settleFrames === undefined && settleTimeoutMs === undefined
      ? {}
      : {
          settle: {
            ...(settleFrames === undefined ? {} : { frames: settleFrames }),
            ...(settleTimeoutMs === undefined ? {} : { timeoutMs: settleTimeoutMs }),
          },
        }),
    ...(actions === undefined ? {} : { actions }),
    ...(values['continue-on-action-error'] === true ? { continueOnActionError: true } : {}),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    includeScreenshot: screenshotPath !== undefined,
    operationId: createOperationId(),
  } as Json & Extract<TParsedWidgetCommand, { subcommand: 'inspect' }>['input'];
  return {
    subcommand,
    input,
    ...(screenshotPath === undefined ? {} : { screenshotPath }),
    overwrite: values.overwrite === true,
  };
}
