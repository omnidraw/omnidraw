import {
  createServerFunctionProxy,
  emitWidgetOutput,
  getWidgetProps,
  subscribeWidgetTheme,
  type TServerFunctionClientOf,
  type TWidgetCapabilitySelector,
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

declare const selector: TWidgetCapabilitySelector;
const generatedCount: TServerFunctionClientOf<typeof serverCount> =
  createServerFunctionProxy('serverCount', selector);

void generatedCount({ text: 'hello' });
void generatedCount({ text: 'hello' }, {
  signal: new AbortController().signal,
  timeoutMs: 1_000,
});
// @ts-expect-error Generated clients reject the wrong input shape.
void generatedCount({ count: 1 });
// @ts-expect-error Generated clients reject unknown call options.
void generatedCount({ text: 'hello' }, { idempotencyKey: 'guest-chosen' });

const props = getWidgetProps<{ title: string }>();
props.title.toUpperCase();
// @ts-expect-error Typed props do not expose undeclared fields.
props.missing;

emitWidgetOutput({
  type: 'notification',
  tone: 'success',
  message: 'Saved',
});
// @ts-expect-error Widgets cannot select an output action outside the fixed contract.
emitWidgetOutput({ type: 'open-url', tone: 'info', message: 'Open' });

subscribeWidgetTheme((theme) => {
  theme.appearance satisfies 'light' | 'dark';
  theme.tokens.background.toUpperCase();
  // @ts-expect-error Typed themes do not expose undeclared tokens.
  theme.other;
});

async function assertInferredOutput(): Promise<void> {
  const result = await generatedCount({ text: 'hello' });
  result.length.toFixed();
  // @ts-expect-error Generated clients preserve the exact output shape.
  result.missing;
}

void assertInferredOutput;
