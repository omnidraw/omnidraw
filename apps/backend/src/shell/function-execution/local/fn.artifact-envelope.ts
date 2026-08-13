/**
 * @file Pure validation of the immutable server-artifact envelope.
 */

export type TServerArtifactOutput = Readonly<{
  path: string;
  loader: string;
  kind: string;
  digestSha256: string;
  bytesBase64: string;
}>;

export type TServerArtifactEnvelope = Readonly<{
  format: 'omnidraw.server-artifact.v1';
  kind: 'server';
  entry: string;
  sourceDigestSha256: string;
  builderIdentity: string;
  runtimeAbi: string;
  outputs: readonly TServerArtifactOutput[];
}>;

type TArgs = Readonly<{
  text: string;
  expectedRuntimeAbi: string;
}>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isArtifactOutput(value: unknown): value is TServerArtifactOutput {
  if (!isRecord(value)) return false;
  return typeof value.path === 'string'
    && value.path.length > 0
    && typeof value.loader === 'string'
    && value.loader.length > 0
    && typeof value.kind === 'string'
    && value.kind.length > 0
    && isSha256(value.digestSha256)
    && typeof value.bytesBase64 === 'string'
    && value.bytesBase64.length > 0;
}

/**
 * Parses metadata only. Byte decoding and both envelope/output digest checks
 * stay at the executor adapter, where cryptographic primitives are injected.
 */
export function fnParseServerArtifactEnvelope(args: TArgs): TServerArtifactEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(args.text);
  } catch {
    throw new Error('Function server artifact is not valid JSON.');
  }
  if (!isRecord(value)) throw new Error('Function server artifact envelope is invalid.');
  if (value.format !== 'omnidraw.server-artifact.v1' || value.kind !== 'server') {
    throw new Error('Function execution requires a dedicated version 1 server artifact.');
  }
  if (
    typeof value.entry !== 'string'
    || value.entry.length === 0
    || typeof value.sourceDigestSha256 !== 'string'
    || !isSha256(value.sourceDigestSha256)
    || typeof value.builderIdentity !== 'string'
    || value.builderIdentity.length === 0
    || typeof value.runtimeAbi !== 'string'
    || value.runtimeAbi !== args.expectedRuntimeAbi
    || !Array.isArray(value.outputs)
    || !value.outputs.every(isArtifactOutput)
  ) {
    throw new Error('Function server artifact metadata is invalid or incompatible.');
  }
  const executableOutputs = value.outputs.filter((output) => (
    output.kind === 'entry-point' && output.loader === 'js'
  ));
  if (executableOutputs.length !== 1) {
    throw new Error('Function server artifact must contain exactly one JavaScript entry point.');
  }
  return Object.freeze({
    format: 'omnidraw.server-artifact.v1',
    kind: 'server',
    entry: value.entry,
    sourceDigestSha256: value.sourceDigestSha256,
    builderIdentity: value.builderIdentity,
    runtimeAbi: value.runtimeAbi,
    outputs: Object.freeze(value.outputs.map((output) => Object.freeze({ ...output }))),
  });
}

export function fnServerArtifactEntryOutput(
  envelope: TServerArtifactEnvelope,
): TServerArtifactOutput {
  const output = envelope.outputs.find((candidate) => (
    candidate.kind === 'entry-point' && candidate.loader === 'js'
  ));
  if (output === undefined) {
    throw new Error('Function server artifact JavaScript entry point is missing.');
  }
  return output;
}
