export interface ArrowTemplate {
  (parent: Node | DocumentFragment): Node | DocumentFragment;
  (): DocumentFragment;
  key(key: string | number | undefined): ArrowTemplate;
  id(id: string | number | undefined): ArrowTemplate;
}

export type ArrowRenderable =
  | string
  | number
  | boolean
  | null
  | undefined
  | ArrowTemplate
  | readonly ArrowRenderable[];

export type ArrowExpression =
  | ArrowRenderable
  | ((...args: unknown[]) => ArrowRenderable)
  | EventListener
  | ((event: InputEvent) => void);

export type ReactiveTarget = Record<PropertyKey, unknown> | unknown[];
export type ReactiveValue<T> = T extends ReactiveTarget ? Reactive<T> | T : T;
export type Reactive<T extends ReactiveTarget> = {
  [P in keyof T]: ReactiveValue<T[P]>;
} & Readonly<{
  $on<P extends keyof T>(property: P, callback: (value?: T[P], previous?: T[P]) => void): void;
  $off<P extends keyof T>(property: P, callback: (value?: T[P], previous?: T[P]) => void): void;
}>;

export type Computed<T> = Readonly<Reactive<{ value: T }>>;
export type EventMap = Record<string, unknown>;
export type Emit<TEvents extends EventMap> = <TName extends keyof TEvents>(
  name: TName,
  payload: TEvents[TName],
) => void;

export declare function html(
  strings: TemplateStringsArray | string[],
  ...expressions: ArrowExpression[]
): ArrowTemplate;
export declare function svg(
  strings: TemplateStringsArray | string[],
  ...expressions: ArrowExpression[]
): ArrowTemplate;
export declare function reactive<T>(effect: () => T): Computed<T>;
export declare function reactive<T extends ReactiveTarget>(data: T): Reactive<T>;
export declare function watch<TValue>(
  effect: () => TValue,
  afterEffect?: (value: TValue) => unknown,
): readonly [unknown, () => void];
export declare function component<TProps extends ReactiveTarget = ReactiveTarget>(
  factory: (props: Reactive<TProps>, emit: Emit<EventMap>) => ArrowTemplate,
): (props?: TProps, events?: Record<string, (payload: unknown) => void>) => unknown;
export declare function pick<T extends object, TKey extends keyof T>(
  source: T,
  ...keys: TKey[]
): Pick<T, TKey>;
export declare function nextTick(callback?: () => unknown): Promise<unknown>;
export declare function onCleanup(callback: () => void): () => void | 0;

export { component as c, pick as props, reactive as r, html as t, watch as w };
