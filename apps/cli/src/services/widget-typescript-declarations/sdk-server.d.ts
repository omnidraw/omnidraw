/**
 * @file Authoring and registration surface for bounded short-lived server functions.
 * This tiny runtime is bundled into each server artifact.
 */
import type { TWidgetServerFunctionDescriptor, TWidgetServerFunctionEffect, TWidgetServerFunctionLimits, TWidgetServerFunctionRetry } from '@vibecanvas/widget-contract';
export type TServerFunctionRuntimeSchema<TValue> = Readonly<{
    parse(value: unknown): TValue;
}>;
export type TServerFunctionResourceDeclaration = Readonly<Record<string, 'read' | 'write' | 'read_write'>>;
type TSchemaValue<TSchema> = TSchema extends TServerFunctionRuntimeSchema<infer TValue> ? TValue : never;
type TReadableSlot<TResources extends TServerFunctionResourceDeclaration> = {
    [TSlot in keyof TResources]: TResources[TSlot] extends 'read' | 'read_write' ? TSlot : never;
}[keyof TResources] & string;
type TWritableSlot<TResources extends TServerFunctionResourceDeclaration> = {
    [TSlot in keyof TResources]: TResources[TSlot] extends 'write' | 'read_write' ? TSlot : never;
}[keyof TResources] & string;
export type TServerFunctionReadResources<TResources extends TServerFunctionResourceDeclaration> = Readonly<{
    read<TOutput = unknown>(slot: TReadableSlot<TResources>, operation: string, input: unknown): Promise<TOutput>;
}>;
export type TServerFunctionWriteResources<TResources extends TServerFunctionResourceDeclaration> = TServerFunctionReadResources<TResources> & Readonly<{
    write<TOutput = unknown>(slot: TWritableSlot<TResources>, operation: string, input: unknown): Promise<TOutput>;
}>;
type TServerFunctionResources<TEffect extends TWidgetServerFunctionEffect, TResources extends TServerFunctionResourceDeclaration> = TEffect extends 'fn' ? Readonly<Record<never, never>> : TEffect extends 'fx' ? TServerFunctionReadResources<TResources> : TServerFunctionWriteResources<TResources>;
export type TServerFunctionContext<TEffect extends TWidgetServerFunctionEffect = TWidgetServerFunctionEffect, TResources extends TServerFunctionResourceDeclaration = TServerFunctionResourceDeclaration> = Readonly<{
    identity: Readonly<{
        orgId: string;
        accountId: string;
        roles: readonly string[];
    }>;
    invocationId: string;
    widgetRevisionId: string;
    subject: Readonly<{
        kind: 'widget_instance';
        canvasId: string;
        widgetInstanceId: string;
    }>;
    attemptId: string;
    leaseEpoch: number;
    deadlineAtMs: number;
    signal: AbortSignal;
    resources: TServerFunctionResources<TEffect, TResources>;
    log: Readonly<{
        debug(fields: Readonly<Record<string, unknown>>, message?: string): void;
        info(fields: Readonly<Record<string, unknown>>, message?: string): void;
        warn(fields: Readonly<Record<string, unknown>>, message?: string): void;
        error(fields: Readonly<Record<string, unknown>>, message?: string): void;
    }>;
    metrics: Readonly<{
        increment(name: string, value?: number): void;
    }>;
}>;
type TResourcesConfig<TEffect extends TWidgetServerFunctionEffect, TResources extends TServerFunctionResourceDeclaration> = TEffect extends 'fn' ? Readonly<{
    resources?: never;
}> : TEffect extends 'fx' ? Readonly<{
    resources: TResources & Readonly<Record<keyof TResources, 'read'>>;
}> : Readonly<{
    resources: TResources;
}>;
export type TServerFunctionConfig<TInputSchema extends TServerFunctionRuntimeSchema<unknown>, TOutputSchema extends TServerFunctionRuntimeSchema<unknown>, TEffect extends TWidgetServerFunctionEffect, TResources extends TServerFunctionResourceDeclaration> = Readonly<{
    effect: TEffect;
    input: TInputSchema;
    output: TOutputSchema;
    limits?: Partial<TWidgetServerFunctionLimits>;
    retry?: TWidgetServerFunctionRetry['mode'];
}> & TResourcesConfig<TEffect, TResources>;
type TServerFunctionRegistration = Omit<TWidgetServerFunctionDescriptor, 'exportName'>;
export type TDefinedServerFunction<TInput, TOutput, TEffect extends TWidgetServerFunctionEffect = TWidgetServerFunctionEffect, TResources extends TServerFunctionResourceDeclaration = TServerFunctionResourceDeclaration> = ((input: TInput) => Promise<TOutput>) & Readonly<{
    __vibecanvasServerFunction: 'vibecanvas.server-function.v1';
    __vibecanvasRegistration: TServerFunctionRegistration;
    __vibecanvasExecute(context: TServerFunctionContext<TEffect, TResources>, input: unknown): Promise<TOutput>;
}>;
export declare function defineServerFunction<TInputSchema extends TServerFunctionRuntimeSchema<unknown>, TOutputSchema extends TServerFunctionRuntimeSchema<unknown>, const TEffect extends TWidgetServerFunctionEffect, const TResources extends TServerFunctionResourceDeclaration>(config: TServerFunctionConfig<TInputSchema, TOutputSchema, TEffect, TResources>, handler: (context: TServerFunctionContext<TEffect, TResources>, input: TSchemaValue<TInputSchema>) => TSchemaValue<TOutputSchema> | Promise<TSchemaValue<TOutputSchema>>): TDefinedServerFunction<TSchemaValue<TInputSchema>, TSchemaValue<TOutputSchema>, TEffect, TResources>;
export declare function isDefinedServerFunction(value: unknown): value is TDefinedServerFunction<unknown, unknown>;
/** Called only inside a registration sandbox after loading the built server entry. */
export declare function collectServerFunctionDescriptors(moduleExports: Readonly<Record<string, unknown>>): readonly TWidgetServerFunctionDescriptor[];
export {};
