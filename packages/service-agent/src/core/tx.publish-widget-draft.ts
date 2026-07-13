import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import { fnNormalizeVibecanvasJson } from '@vibecanvas/service-actor/core/fn.normalize-actor-manifest';
import type { TActorServiceReloader } from './types';
import { fxWalkFiles } from './fx.walk-files';
import { fnAssertSafeFinalDestination } from './fn.safe-destination';
import { txValidateWidgetFiles } from './tx.validate-widget-files';

export type TDirent = {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
};

export type TPortalPublishWidgetDraft = {
  readdir: (path: string, options: { withFileTypes: true }) => Promise<TDirent[]>;
  readFile: (path: string, encoding: 'utf8') => Promise<string>;
  writeFile: (path: string, content: string, encoding: 'utf8') => Promise<void>;
  mkdir: (path: string, options: { recursive: true }) => Promise<string | undefined>;
  rm: (path: string, options: { recursive: true; force: true } | { force: true }) => Promise<void>;
  execFile: (
    file: string,
    args: readonly string[],
    options: { cwd: string; timeout: number; maxBuffer: number },
    callback: (error: Error | null, stdout: unknown, stderr: unknown) => void,
  ) => void;
  cp: (source: string, destination: string, options: { recursive: true; filter: (source: string) => boolean }) => Promise<void>;
  join: (...paths: string[]) => string;
  relative: (from: string, to: string) => string;
  resolve: (...paths: string[]) => string;
  basename: (path: string) => string;
};

export type TArgsPublishWidgetDraft = {
  cwd: string;
  finalWidgetsDir: string;
  actorService?: TActorServiceReloader;
  sdkActorTypePath: string;
};

export async function txPublishWidgetDraft(portal: TPortalPublishWidgetDraft, args: TArgsPublishWidgetDraft) {
  const manifestPath = portal.join(args.cwd, 'vibecanvas.json');
  const draftManifest = JSON.parse(await portal.readFile(manifestPath, 'utf8')) as TVibecanvasJson;
  const validation = await txValidateWidgetFiles(portal, { cwd: args.cwd, sdkActorTypePath: args.sdkActorTypePath });
  if (!validation.ok) {
    return { published: false, manifest: draftManifest, validation, destination: null as string | null, files: [] as string[] };
  }

  const manifest = fnNormalizeVibecanvasJson(draftManifest).manifest;
  await portal.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const destination = fnAssertSafeFinalDestination({ finalWidgetsDir: args.finalWidgetsDir, slug: manifest.slug, basename: portal.basename, resolve: portal.resolve });
  await portal.mkdir(args.finalWidgetsDir, { recursive: true });
  await portal.rm(destination, { recursive: true, force: true });
  await portal.cp(args.cwd, destination, { recursive: true, filter: (source) => !source.includes(`${args.cwd}/.vibecanvas-wizard`) });
  await args.actorService?.reload();
  const files = await fxWalkFiles(portal, { root: destination });
  return { published: true, manifest, validation, destination, files };
}
