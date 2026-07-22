// @ts-expect-error Bun's file loader returns the source path instead of the TypeScript module exports.
import sdkActorSourcePath from '../../../sdk/src/actor.ts' with { type: 'file' };
// @ts-expect-error Bun's file loader returns the source path instead of the TypeScript module exports.
import sdkCollaborativeStateSourcePath from '../../../sdk/src/collaborative-state-client.ts' with { type: 'file' };
// @ts-expect-error Bun's file loader returns the source path instead of the TypeScript module exports.
import sdkFunctionClientSourcePath from '../../../sdk/src/function-client.ts' with { type: 'file' };
import sdkPackage from '../../../sdk/package.json';
// @ts-expect-error Bun's file loader returns the source path instead of the TypeScript module exports.
import sdkServerSourcePath from '../../../sdk/src/server.ts' with { type: 'file' };
// @ts-expect-error Bun's file loader returns the source path instead of the TypeScript module exports.
import sdkSharedSourcePath from '../../../sdk/src/shared.ts' with { type: 'file' };
// @ts-expect-error Bun's file loader returns the source path instead of the TypeScript module exports.
import sdkTypesSourcePath from '../../../sdk/src/types.ts' with { type: 'file' };
// @ts-expect-error Bun's file loader returns the source path instead of the TypeScript module exports.
import sdkWidgetBridgeSourcePath from '../../../sdk/src/widget-bridge.ts' with { type: 'file' };
// @ts-expect-error Bun's file loader returns the source path instead of the TypeScript module exports.
import sdkWidgetSourcePath from '../../../sdk/src/widget.ts' with { type: 'file' };

export const SDK_PACKAGE_ASSETS = [
  { relativePath: 'src/actor.ts', sourcePath: sdkActorSourcePath as unknown as string },
  { relativePath: 'src/collaborative-state-client.ts', sourcePath: sdkCollaborativeStateSourcePath as unknown as string },
  { relativePath: 'src/function-client.ts', sourcePath: sdkFunctionClientSourcePath as unknown as string },
  { relativePath: 'src/server.ts', sourcePath: sdkServerSourcePath as unknown as string },
  { relativePath: 'src/shared.ts', sourcePath: sdkSharedSourcePath as unknown as string },
  { relativePath: 'src/types.ts', sourcePath: sdkTypesSourcePath as unknown as string },
  { relativePath: 'src/widget-bridge.ts', sourcePath: sdkWidgetBridgeSourcePath as unknown as string },
  { relativePath: 'src/widget.ts', sourcePath: sdkWidgetSourcePath as unknown as string },
] as const;

export const SDK_PACKAGE_JSON = `${JSON.stringify({
  name: sdkPackage.name,
  version: sdkPackage.version,
  type: sdkPackage.type,
  exports: {
    './widget': {
      types: './src/widget.ts',
      default: './src/widget.ts',
    },
    './actor': {
      types: './src/actor.ts',
      default: './src/actor.ts',
    },
    './server': {
      types: './src/server.ts',
      default: './src/server.ts',
    },
    './function-client': {
      types: './src/function-client.ts',
      default: './src/function-client.ts',
    },
  },
  dependencies: sdkPackage.dependencies,
}, null, 2)}\n`;
