import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Layer, ManagedRuntime } from 'effect';
import { fnResolveOmnidrawHome } from '../../shell/config/fn.resolve-omnidraw-home';
import type { ICliConfig } from '../../shell/cli/config';
import { layerCanvasAuthorityFromLive } from '../../shell/canvas/layer.canvas-authority.live';
import { layerLiveMechanics } from '../../shell/runtime/layer.live-mechanics';
import { layerSemanticAuthoritiesLive } from '../../shell/runtime/layer.semantic-authorities';

/** A fresh, source-run production Layer graph used only by live conformance tests. */
export async function createLiveMechanicsConformanceRuntime(label: string) {
  const homeDirectory = await mkdtemp(join(tmpdir(), `omnidraw-${label}-`));
  const home = fnResolveOmnidrawHome(
    { join, resolve },
    { cwd: homeDirectory, homedir: homeDirectory, env: {}, dataDir: homeDirectory },
  );
  const config: ICliConfig = Object.freeze({
    cwd: homeDirectory,
    dev: false,
    version: 'conformance',
    command: 'serve',
    rawArgv: [],
    argv: [],
    port: 0,
    home,
    helpRequested: false,
    versionRequested: false,
  });
  const mechanics = layerLiveMechanics({
    config,
    piAuthSourcePath: join(homeDirectory, 'missing-pi-auth.json'),
  });
  const semantic = layerSemanticAuthoritiesLive.pipe(Layer.provide(mechanics));
  const canvas = layerCanvasAuthorityFromLive.pipe(Layer.provide(mechanics));
  const runtime = ManagedRuntime.make(Layer.mergeAll(mechanics, semantic, canvas));
  let disposed = false;
  return Object.freeze({
    homeDirectory,
    runtime,
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      try {
        await runtime.dispose();
      } finally {
        await rm(homeDirectory, { recursive: true, force: true });
      }
    },
  });
}
