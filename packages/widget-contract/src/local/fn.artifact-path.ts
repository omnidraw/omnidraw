import {
  WIDGET_ARTIFACT_BLOB_DIRECTORY,
  WIDGET_ARTIFACT_DIGEST_ALGORITHM,
  WIDGET_ARTIFACT_TEMP_SUFFIX,
} from './CONSTANTS';

export type TArtifactPathJoin = (...parts: string[]) => string;

export function fnValidateArtifactDigest(digestSha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(digestSha256)) {
    throw new Error('Artifact digest must be a lowercase SHA-256 hex string.');
  }
  return digestSha256;
}

export function fnArtifactBlobRelativePath(digestSha256: string): string {
  const digest = fnValidateArtifactDigest(digestSha256);
  return `${WIDGET_ARTIFACT_BLOB_DIRECTORY}/${WIDGET_ARTIFACT_DIGEST_ALGORITHM}/${digest.slice(0, 2)}/${digest}`;
}

export function fnArtifactBlobPath(
  join: TArtifactPathJoin,
  args: Readonly<{ artifactsRoot: string; digestSha256: string }>,
): string {
  const digest = fnValidateArtifactDigest(args.digestSha256);
  return join(
    args.artifactsRoot,
    WIDGET_ARTIFACT_BLOB_DIRECTORY,
    WIDGET_ARTIFACT_DIGEST_ALGORITHM,
    digest.slice(0, 2),
    digest,
  );
}

export function fnArtifactTempPath(
  join: TArtifactPathJoin,
  args: Readonly<{ artifactsRoot: string; digestSha256: string; nonce: string }>,
): string {
  if (!/^[0-9A-Za-z_-]{1,128}$/.test(args.nonce)) {
    throw new Error('Artifact temp nonce is invalid.');
  }
  return `${fnArtifactBlobPath(join, args)}.${args.nonce}${WIDGET_ARTIFACT_TEMP_SUFFIX}`;
}
