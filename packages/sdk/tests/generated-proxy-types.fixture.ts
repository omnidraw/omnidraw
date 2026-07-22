import {
  createServerFunctionProxy,
  type IServerFunctionClientTransport,
  type TServerFunctionClientOf,
} from '../src/widget';
import {
  defineServerFunction,
  type TServerFunctionRuntimeSchema,
} from '../src/server';

const input = {
  parse: (value: unknown) => value as { text: string },
  toJSONSchema: () => ({ type: 'object' }),
} satisfies TServerFunctionRuntimeSchema<{ text: string }> & { toJSONSchema(): unknown };
const output = {
  parse: (value: unknown) => value as { length: number },
  toJSONSchema: () => ({ type: 'object' }),
} satisfies TServerFunctionRuntimeSchema<{ length: number }> & { toJSONSchema(): unknown };

const serverCount = defineServerFunction({
  effect: 'fn',
  input,
  output,
}, (_context, value) => ({ length: value.text.length }));

declare const transport: IServerFunctionClientTransport;
const generatedCount: TServerFunctionClientOf<typeof serverCount> =
  createServerFunctionProxy('serverCount', transport);

void generatedCount({ text: 'hello' });
// @ts-expect-error Generated clients reject the wrong input shape.
void generatedCount({ count: 1 });

async function assertInferredOutput(): Promise<void> {
  const result = await generatedCount({ text: 'hello' });
  result.length.toFixed();
  // @ts-expect-error Generated clients preserve the exact output shape.
  result.missing;
}

void assertInferredOutput;
