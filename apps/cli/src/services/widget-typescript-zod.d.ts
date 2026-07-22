export type Simplify<T> = { [K in keyof T]: T[K] } & {};

export interface ZodType<TOutput = unknown, TInput = TOutput> {
  readonly _output: TOutput;
  readonly _input: TInput;
  parse(value: unknown): TOutput;
  safeParse(value: unknown):
    | Readonly<{ success: true; data: TOutput }>
    | Readonly<{ success: false; error: unknown }>;
  optional(): ZodOptional<this>;
  nullable(): ZodNullable<this>;
  nullish(): ZodOptional<ZodNullable<this>>;
  array(): ZodArray<this>;
  default(value: Exclude<TOutput, undefined> | (() => Exclude<TOutput, undefined>)): ZodDefault<this>;
  describe(description: string): this;
  refine(check: (value: TOutput) => unknown, message?: string | Readonly<{ message?: string }>): this;
  superRefine(check: (value: TOutput, context: unknown) => void): this;
  transform<TNewOutput>(transform: (value: TOutput) => TNewOutput): ZodType<TNewOutput, TInput>;
  toJSONSchema(): Readonly<Record<string, unknown>>;
}

export type ZodTypeAny = ZodType<any, any>;
export type output<TSchema extends ZodTypeAny> = TSchema['_output'];
export type input<TSchema extends ZodTypeAny> = TSchema['_input'];
export type infer<TSchema extends ZodTypeAny> = output<TSchema>;

export interface ZodOptional<TSchema extends ZodTypeAny>
  extends ZodType<output<TSchema> | undefined, input<TSchema> | undefined> {
  unwrap(): TSchema;
}

export interface ZodNullable<TSchema extends ZodTypeAny>
  extends ZodType<output<TSchema> | null, input<TSchema> | null> {
  unwrap(): TSchema;
}

export interface ZodDefault<TSchema extends ZodTypeAny>
  extends ZodType<Exclude<output<TSchema>, undefined>, input<TSchema> | undefined> {
  unwrap(): TSchema;
}

export interface ZodString extends ZodType<string> {
  min(length: number, message?: string): this;
  max(length: number, message?: string): this;
  length(length: number, message?: string): this;
  email(message?: string): this;
  url(message?: string): this;
  uuid(message?: string): this;
  regex(pattern: RegExp, message?: string): this;
  trim(): this;
  toLowerCase(): this;
  toUpperCase(): this;
}

export interface ZodNumber extends ZodType<number> {
  min(value: number, message?: string): this;
  max(value: number, message?: string): this;
  int(message?: string): this;
  finite(message?: string): this;
  positive(message?: string): this;
  nonnegative(message?: string): this;
  negative(message?: string): this;
  nonpositive(message?: string): this;
}

export interface ZodBigInt extends ZodType<bigint> {
  positive(message?: string): this;
  nonnegative(message?: string): this;
  negative(message?: string): this;
  nonpositive(message?: string): this;
}

export interface ZodBoolean extends ZodType<boolean> {}
export interface ZodDate extends ZodType<Date> {}
export interface ZodUnknown extends ZodType<unknown> {}
export interface ZodAny extends ZodType<any> {}
export interface ZodNever extends ZodType<never> {}
export interface ZodVoid extends ZodType<void> {}
export interface ZodNull extends ZodType<null> {}
export interface ZodUndefined extends ZodType<undefined> {}

export interface ZodLiteral<TValue extends string | number | bigint | boolean | null>
  extends ZodType<TValue> {
  readonly value: TValue;
}

export interface ZodEnum<TValues extends readonly [string, ...string[]]>
  extends ZodType<TValues[number]> {
  readonly options: TValues;
}

export interface ZodArray<TElement extends ZodTypeAny>
  extends ZodType<output<TElement>[], input<TElement>[]> {
  readonly element: TElement;
  min(length: number, message?: string): this;
  max(length: number, message?: string): this;
  length(length: number, message?: string): this;
}

export interface ZodTuple<TItems extends readonly ZodTypeAny[]>
  extends ZodType<{ [K in keyof TItems]: output<TItems[K]> }> {}

export interface ZodUnion<TOptions extends readonly [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]>
  extends ZodType<output<TOptions[number]>> {}

export interface ZodRecord<TKey extends string | number | symbol, TValue extends ZodTypeAny>
  extends ZodType<Partial<Record<TKey, output<TValue>>>> {}

export type ZodRawShape = Readonly<Record<string, ZodTypeAny>>;
export type OptionalKeys<TShape extends ZodRawShape> = {
  [K in keyof TShape]-?: undefined extends output<TShape[K]> ? K : never;
}[keyof TShape];
export type RequiredKeys<TShape extends ZodRawShape> = Exclude<keyof TShape, OptionalKeys<TShape>>;
export type ObjectOutput<TShape extends ZodRawShape> = Simplify<
  { [K in RequiredKeys<TShape>]: output<TShape[K]> }
  & { [K in OptionalKeys<TShape>]?: Exclude<output<TShape[K]>, undefined> }
>;
export type ObjectInput<TShape extends ZodRawShape> = Simplify<
  { [K in RequiredKeys<TShape>]: input<TShape[K]> }
  & { [K in OptionalKeys<TShape>]?: input<TShape[K]> }
>;

export interface ZodObject<TShape extends ZodRawShape>
  extends ZodType<ObjectOutput<TShape>, ObjectInput<TShape>> {
  readonly shape: TShape;
  strict(): this;
  passthrough(): this;
  strip(): this;
  extend<TExtra extends ZodRawShape>(shape: TExtra): ZodObject<TShape & TExtra>;
  merge<TOther extends ZodRawShape>(other: ZodObject<TOther>): ZodObject<TShape & TOther>;
  pick<TKeys extends keyof TShape>(keys: Readonly<Record<TKeys, true>>): ZodObject<Pick<TShape, TKeys>>;
  omit<TKeys extends keyof TShape>(keys: Readonly<Record<TKeys, true>>): ZodObject<Omit<TShape, TKeys>>;
  partial(): ZodObject<{ [K in keyof TShape]: ZodOptional<TShape[K]> }>;
  required(): ZodObject<{
    [K in keyof TShape]: TShape[K] extends ZodOptional<infer TInner> ? TInner : TShape[K];
  }>;
}

export declare function string(): ZodString;
export declare function number(): ZodNumber;
export declare function bigint(): ZodBigInt;
export declare function boolean(): ZodBoolean;
export declare function date(): ZodDate;
export declare function unknown(): ZodUnknown;
export declare function any(): ZodAny;
export declare function never(): ZodNever;
export declare function literal<const TValue extends string | number | bigint | boolean | null>(
  value: TValue,
): ZodLiteral<TValue>;
export declare function array<TElement extends ZodTypeAny>(element: TElement): ZodArray<TElement>;
export declare function tuple<const TItems extends readonly ZodTypeAny[]>(items: TItems): ZodTuple<TItems>;
export declare function union<
  const TOptions extends readonly [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]],
>(options: TOptions): ZodUnion<TOptions>;
export declare function object<const TShape extends ZodRawShape>(shape: TShape): ZodObject<TShape>;
export declare function record<TValue extends ZodTypeAny>(value: TValue): ZodRecord<string, TValue>;
export declare function record<TKey extends string | number | symbol, TValue extends ZodTypeAny>(
  key: ZodType<TKey>,
  value: TValue,
): ZodRecord<TKey, TValue>;
export declare function lazy<TSchema extends ZodTypeAny>(schema: () => TSchema): TSchema;
export declare function preprocess<TSchema extends ZodTypeAny>(
  transform: (value: unknown) => unknown,
  schema: TSchema,
): TSchema;
export declare function custom<TOutput = unknown>(check?: (value: unknown) => unknown): ZodType<TOutput>;

declare function zodEnum<const TValues extends readonly [string, ...string[]]>(
  values: TValues,
): ZodEnum<TValues>;
declare function zodNull(): ZodNull;
declare function zodUndefined(): ZodUndefined;
declare function zodVoid(): ZodVoid;
export { zodEnum as enum, zodNull as null, zodUndefined as undefined, zodVoid as void };
