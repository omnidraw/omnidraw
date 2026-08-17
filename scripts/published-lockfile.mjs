/**
 * @file Committed lockfile policy for `@omnidraw/cangine` and `@omnidraw/capsule`.
 *
 * Local `link:local` may rewrite bun.lock to the loopback Verdaccio URL. That
 * checkout is valid on one machine. CI and a clean clone must resolve those
 * exact versions from the public npm registry.
 */

export const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org';
export const QUALIFICATION_REGISTRY_PACKAGES = Object.freeze(['@omnidraw/cangine', '@omnidraw/capsule']);

const LOCAL_TARBALL_URL = /"(https?:\/\/127\.0\.0\.1:\d+\/[^"]*)"/g;

export function localRegistryTarballUrls(lockfileText) {
  return [...lockfileText.matchAll(LOCAL_TARBALL_URL)].map((match) => match[1]);
}

export function restorePublishedLockfileUrls(lockfileText) {
  return lockfileText.replace(LOCAL_TARBALL_URL, '""');
}

export function explainLocalLockfileUrls(urls) {
  const listed = [...new Set(urls)].sort().map((url) => `  ${url}`).join('\n');
  return [
    'Committed bun.lock points at the local Verdaccio registry:',
    listed,
    '',
    'CI has no local registry, so install fails with ConnectionRefused on 127.0.0.1:4873.',
    'Commit and push as usual; git hooks strip these URLs. Do not use --no-verify.',
  ].join('\n');
}

export function qualificationPackageShortName(name) {
  if (name === '@omnidraw/cangine') return 'cangine';
  if (name === '@omnidraw/capsule') return 'capsule';
  return name;
}

export function explainUnpublishedPackage(name, version) {
  const short = qualificationPackageShortName(name);
  return [
    `${name}@${version} is not published on ${PUBLIC_NPM_REGISTRY}/.`,
    'CI installs only published versions, so this failure is expected until that exact version exists on npm.',
    `Publish ${name}@${version} from the ${short} repository.`,
    `Local unpublished builds: bun run link:local -- ${short} && bun install.`,
  ].join('\n');
}

export function publicPackageMetadataUrl(name, version, registry = PUBLIC_NPM_REGISTRY) {
  return `${registry.replace(/\/$/u, '')}/${name.replace('/', '%2f')}/${version}`;
}
