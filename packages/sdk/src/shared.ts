export type TVibecanvasJsonValue =
  | string
  | number
  | boolean
  | null
  | TVibecanvasJsonValue[]
  | { [key: string]: TVibecanvasJsonValue | undefined };

export type TActorRuntimeState =
  | 'booting'
  | `booting.${string}`
  | 'ready'
  | `ready.${string}`
  | 'busy'
  | `busy.${string}`
  | 'waiting'
  | `waiting.${string}`
  | 'error'
  | `error.${string}`;

export type TActorSystemStatus =
  | 'created'
  | 'starting'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'error'
  | 'blocked';

export type TMessageMap = Record<string, TVibecanvasJsonValue>;

export type TUnsubscribe = () => void;

export type TSdkError = {
  readonly code: string;
  readonly message: string;
  readonly details?: TVibecanvasJsonValue;
};

export type TActorOutputEnvelope<TOutputName extends string = string, TPayload = TVibecanvasJsonValue> = {
  readonly type: TOutputName;
  readonly payload: TPayload;
};
