import type {
  TCanvasCommand,
  TCanvasItemPage,
  TCanvasItemPatch,
  TCanvasItemQueryCursor,
  TCanvasItemQueryFilter,
  TCanvasItemsChangedEvent,
  TCanvasSnapshot,
} from '@omnidraw/canvas-contract';

export type TCanvasCliSubcommand =
  | 'list'
  | 'query'
  | 'add'
  | 'patch'
  | 'move'
  | 'group'
  | 'ungroup'
  | 'reorder'
  | 'delete';

export type TCanvasListEntry = Readonly<{
  id: string;
  name: string;
  revision: number;
  created_at: string;
}>;

export type TCanvasApiResult<T> = Promise<
  readonly [error: unknown | null, result: T | undefined]
>;

export interface ICanvasCliApi {
  list(): TCanvasApiResult<readonly TCanvasListEntry[]>;
  snapshot(input: Readonly<{ canvasId: string }>): TCanvasApiResult<TCanvasSnapshot>;
  query(input: Readonly<{
    canvasId: string;
    filter: TCanvasItemQueryFilter;
    limit?: number;
    cursor?: TCanvasItemQueryCursor;
  }>): TCanvasApiResult<TCanvasItemPage>;
  execute(input: TCanvasCommand): TCanvasApiResult<TCanvasItemsChangedEvent>;
}

export interface ICanvasRpcConnection {
  api: ICanvasCliApi;
  close(): Promise<void>;
}

export type TCanvasSelector = Readonly<{
  canvasId?: string;
  canvasNameQuery?: string;
}>;

export type TCanvasMutationInput = TCanvasSelector & Readonly<{
  dryRun: boolean;
}>;

export type TCanvasNode = Extract<
  TCanvasCommand['operations'][number],
  Readonly<{ type: 'insert' }>
>['item'];

export type TCanvasQueryInput = TCanvasSelector & Readonly<{
  filter: TCanvasItemQueryFilter;
  limit?: number;
  cursor?: TCanvasItemQueryCursor;
}>;

export type TCanvasAddInput = TCanvasMutationInput & Readonly<{
  items: readonly TCanvasNode[];
}>;

export type TCanvasPatchInput = TCanvasMutationInput & Readonly<{
  ids: readonly string[];
  patches: readonly TCanvasItemPatch[];
}>;

export type TCanvasMoveInput = TCanvasMutationInput & Readonly<{
  ids: readonly string[];
  mode: 'absolute' | 'relative';
  x?: number;
  y?: number;
}>;

export type TCanvasGroupInput = TCanvasMutationInput & Readonly<{
  ids: readonly string[];
  groupId: string;
}>;

export type TCanvasUngroupInput = TCanvasMutationInput & Readonly<{
  groupId: string;
}>;

export type TCanvasReorderInput = TCanvasMutationInput & Readonly<{
  id: string;
  orderKey: string;
}>;

export type TCanvasDeleteInput = TCanvasMutationInput & Readonly<{
  ids: readonly string[];
}>;

export type TCanvasCliOutput = Readonly<{
  text: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export type TParsedCanvasCommand =
  | Readonly<{ subcommand: 'list' }>
  | Readonly<{ subcommand: 'query'; input: TCanvasQueryInput }>
  | Readonly<{ subcommand: 'add'; input: TCanvasAddInput }>
  | Readonly<{ subcommand: 'patch'; input: TCanvasPatchInput }>
  | Readonly<{ subcommand: 'move'; input: TCanvasMoveInput }>
  | Readonly<{ subcommand: 'group'; input: TCanvasGroupInput }>
  | Readonly<{ subcommand: 'ungroup'; input: TCanvasUngroupInput }>
  | Readonly<{ subcommand: 'reorder'; input: TCanvasReorderInput }>
  | Readonly<{ subcommand: 'delete'; input: TCanvasDeleteInput }>;

export type TCanvasCliErrorPayload = Readonly<{
  ok: false;
  command: string;
  code: string;
  message: string;
  hint?: string;
  next?: string;
}>;
