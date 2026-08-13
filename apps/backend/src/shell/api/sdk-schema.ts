import type { TSdkValidator } from '@omnidraw/sdk/contract';
import { z } from 'zod';

/**
 * Application transport uses Zod internally, but portable validation belongs
 * to the SDK. This projection delegates acceptance and normalization to the
 * SDK validator and exposes only a private Zod wrapper to RPC composition.
 */
export function sdkSchema<T>(validator: TSdkValidator<T>): z.ZodType<T> {
  return z.custom<T>(
    (value) => validator.is(value),
    { message: 'Value does not satisfy the portable @omnidraw/sdk contract.' },
  ).transform((value) => validator.parse(value));
}
