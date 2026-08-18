import { Layer, ManagedRuntime } from 'effect';
import type { ICliConfig } from '../cli/config';
import { layerCanvasAuthorityFromLive } from '../canvas/layer.canvas-authority.live';
import { layerLiveMechanics } from './layer.live-mechanics';
import { layerBackendServer } from '../server/layer.server';
import { layerSemanticAuthoritiesLive } from './layer.semantic-authorities';
import { layerCanvasDeletionLive } from '../canvas/layer.canvas-deletion.live';

/** Exactly one ManagedRuntime is constructed for each backend process. */
export function createBackendRuntime(args: Readonly<{
  config: ICliConfig;
  piAuthSourcePath: string;
  repositoryRoot: string;
}>) {
  const mechanics = layerLiveMechanics({
    config: args.config,
    piAuthSourcePath: args.piAuthSourcePath,
    repositoryRoot: args.repositoryRoot,
  });
  const canvasAuthority = layerCanvasAuthorityFromLive.pipe(
    Layer.provide(mechanics),
  );
  const semanticAuthorities = layerSemanticAuthoritiesLive.pipe(
    Layer.provide(mechanics),
  );
  const canvasDeletion = layerCanvasDeletionLive.pipe(Layer.provide(mechanics));
  const runtimeServices = Layer.merge(
    mechanics,
    Layer.mergeAll(canvasAuthority, semanticAuthorities, canvasDeletion),
  );
  const server = layerBackendServer(args.config).pipe(Layer.provide(runtimeServices));
  return ManagedRuntime.make(Layer.merge(runtimeServices, server));
}
