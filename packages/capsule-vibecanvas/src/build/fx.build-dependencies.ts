import type {
  CapsuleDependencyContentStore,
  CapsuleDependencyLockEntry,
  CapsuleProvidedPackage,
  CapsuleSnapshotFile,
} from '@omnidraw/capsule/build';
import {
  VIBECANVAS_CAPSULE_REACT_PACKAGE_PROJECTIONS,
  VIBECANVAS_CAPSULE_REACT_ROOT_DEPENDENCIES,
  type TVibecanvasCapsuleReactPackageName,
} from './CONSTANTS';

export type TPortal = Readonly<{
  readFile(path: string): Promise<Uint8Array>;
  joinPath(root: string, path: string): string;
  calculateDependencyMetadata(
    input: Pick<
      CapsuleDependencyLockEntry,
      'name' | 'version' | 'exports' | 'dependencies'
    >,
  ): Promise<`sha256:${string}`>;
  calculateDependencyContent(
    files: readonly CapsuleSnapshotFile[],
  ): Promise<`sha256:${string}`>;
}>;

export type TVibecanvasReactPackageRoots = Readonly<
  Record<TVibecanvasCapsuleReactPackageName, string>
>;

export type TArgs = Readonly<{
  sdkWidgetPath: string;
  sdkFunctionClientPath: string;
  sdkTypeFiles: readonly Readonly<{ path: string; sourcePath: string }>[];
  capsuleGuestPath: string;
  capsuleGuestTypeFiles: readonly Readonly<{ path: string; sourcePath: string }>[];
  reactPackageRoots?: TVibecanvasReactPackageRoots;
}>;

function file(path: string, bytes: Uint8Array): CapsuleSnapshotFile {
  return Object.freeze({ path, bytes });
}

type TDependencyInput = Readonly<{
  metadata: Pick<
    CapsuleDependencyLockEntry,
    'name' | 'version' | 'exports' | 'dependencies'
  >;
  files: readonly CapsuleSnapshotFile[];
}>;

type TLockedDependency = Readonly<{
  lock: CapsuleDependencyLockEntry;
  content: CapsuleDependencyContentStore['entries'][number];
}>;

export type TVibecanvasBuildDependencies = Readonly<{
  rootDependencies: Readonly<Record<string, string>>;
  lockEntries: readonly CapsuleDependencyLockEntry[];
  contentEntries: CapsuleDependencyContentStore['entries'];
  providedPackages: readonly CapsuleProvidedPackage[];
}>;

/**
 * Serializes trusted public distributions into Capsule's closed dependency
 * graph. Compiled Capsule, SDK, and reviewed React distributions are locked,
 * not provided: Capsule independently verifies the exact React projection
 * before enabling its trusted JSX transform.
 */
export async function fxCreateVibecanvasBuildDependencies(
  portal: TPortal,
  args: TArgs,
): Promise<TVibecanvasBuildDependencies> {
  const [
    widgetBytes,
    functionClientBytes,
    guestBytes,
    sdkTypes,
    capsuleGuestTypes,
  ] = await Promise.all([
    portal.readFile(args.sdkWidgetPath),
    portal.readFile(args.sdkFunctionClientPath),
    portal.readFile(args.capsuleGuestPath),
    Promise.all(args.sdkTypeFiles.map(async (item) => (
      file(item.path, await portal.readFile(item.sourcePath))
    ))),
    Promise.all(args.capsuleGuestTypeFiles.map(async (item) => (
      file(item.path, await portal.readFile(item.sourcePath))
    ))),
  ]);
  const dependencyInputs: TDependencyInput[] = [
    Object.freeze({
      metadata: Object.freeze({
        name: '@omnidraw/capsule',
        version: '0.9.2',
        exports: Object.freeze({
          './guest': Object.freeze({
            runtime: 'guest.js',
            types: Object.freeze({
              package: '@omnidraw/capsule',
              path: 'types/guest.d.ts',
            }),
          }),
        }),
        dependencies: Object.freeze({}),
      }),
      files: Object.freeze([
        file('guest.js', guestBytes),
        ...capsuleGuestTypes,
      ]),
    }),
    Object.freeze({
      metadata: Object.freeze({
        name: '@vibecanvas/sdk',
        version: '0.1.0',
        exports: Object.freeze({
          './widget': Object.freeze({
            runtime: 'runtime/widget.js',
            types: Object.freeze({ package: '@vibecanvas/sdk', path: 'widget.d.ts' }),
          }),
          './function-client': Object.freeze({
            runtime: 'runtime/function-client.js',
            types: Object.freeze({
              package: '@vibecanvas/sdk',
              path: 'function-client.d.ts',
            }),
          }),
        }),
        dependencies: Object.freeze({ '@omnidraw/capsule': '0.9.2' }),
      }),
      files: Object.freeze([
        file('runtime/function-client.js', functionClientBytes),
        file('runtime/widget.js', widgetBytes),
        ...sdkTypes,
      ]),
    }),
  ];
  if (args.reactPackageRoots !== undefined) {
    const reactInputs = await Promise.all(
      VIBECANVAS_CAPSULE_REACT_PACKAGE_PROJECTIONS.map(async (projection) => (
        Object.freeze({
          metadata: Object.freeze({
            name: projection.name,
            version: projection.version,
            exports: projection.exports,
            dependencies: projection.dependencies,
          }),
          files: Object.freeze(await Promise.all(projection.filePaths.map(async (path) => (
            file(
              path,
              await portal.readFile(portal.joinPath(
                args.reactPackageRoots![projection.name],
                path,
              )),
            )
          )))),
        })
      )),
    );
    dependencyInputs.push(...reactInputs);
  }
  const locked = await Promise.all(dependencyInputs.map(async (
    input,
  ): Promise<TLockedDependency> => {
    const [metadataDigest, contentDigest] = await Promise.all([
      portal.calculateDependencyMetadata(input.metadata),
      portal.calculateDependencyContent(input.files),
    ]);
    return Object.freeze({
      lock: Object.freeze({
        ...input.metadata,
        metadataDigest,
        contentDigest,
      }),
      content: Object.freeze({
        digest: contentDigest,
        files: input.files,
      }),
    });
  }));
  locked.sort((left, right) => left.lock.name.localeCompare(right.lock.name));

  return Object.freeze({
    rootDependencies: Object.freeze({
      '@vibecanvas/sdk': '0.1.0',
      ...(args.reactPackageRoots === undefined
        ? {}
        : VIBECANVAS_CAPSULE_REACT_ROOT_DEPENDENCIES),
    }),
    lockEntries: Object.freeze(locked.map(({ lock }) => lock)),
    contentEntries: Object.freeze(locked.map(({ content }) => content)),
    providedPackages: Object.freeze([]),
  });
}
