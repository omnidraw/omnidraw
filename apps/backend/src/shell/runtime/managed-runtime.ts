import { Layer, ManagedRuntime } from 'effect';
import type { ICliConfig } from '../cli/config';
import { layerCanvasAuthorityFromLive } from '../canvas/layer.canvas-authority.live';
import { layerLiveMechanics } from './layer.live-mechanics';
import { layerBackendServer } from '../server/layer.server';
import { layerSemanticAuthoritiesLive } from './layer.semantic-authorities';

/** Exactly one ManagedRuntime is constructed for each backend process. */
export function createBackendRuntime(args: Readonly<{
  config: ICliConfig;
  repositoryRoot: string;
}>) {
  const mechanics = layerLiveMechanics({
    config: args.config,
    repositoryRoot: args.repositoryRoot,
  });
  const canvasAuthority = layerCanvasAuthorityFromLive.pipe(
    Layer.provide(mechanics),
  );
  const semanticAuthorities = layerSemanticAuthoritiesLive.pipe(
    Layer.provide(mechanics),
  );
  const runtimeServices = Layer.merge(
    mechanics,
    Layer.merge(canvasAuthority, semanticAuthorities),
  );
  const server = layerBackendServer(args.config).pipe(Layer.provide(runtimeServices));
  return ManagedRuntime.make(Layer.merge(runtimeServices, server));
}
