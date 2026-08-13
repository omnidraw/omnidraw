import type { TWidgetManifestV1 } from '#backend/core/widget-domain';
import type { TWidgetCreateInput } from '../workspace/types';
import {
  WIDGET_TEMPLATE_FILES,
  WIDGET_TEMPLATE_TOKENS,
} from './templates/CONSTANTS';

type TEffects = {
  mkdir: (path: string, options: { recursive: true }) => Promise<string | undefined>;
  writeFile: (path: string, content: string, encoding: 'utf8') => Promise<void>;
  join: (...paths: string[]) => string;
};

type TArgs = {
  cwd: string;
  manifest: TWidgetManifestV1;
  sdkDependency: string;
  template: NonNullable<TWidgetCreateInput['template']>;
  server: boolean;
};

function replaceAll(content: string, token: string, value: string): string {
  return content.split(token).join(value);
}

function renderTemplateFile(content: string, args: TArgs): string {
  const replacements = [
    [WIDGET_TEMPLATE_TOKENS.widgetSlug, args.manifest.slug],
    [WIDGET_TEMPLATE_TOKENS.sdkDependency, args.sdkDependency],
    // Replace the whole manifest last so user-authored text inside it is never
    // interpreted as another template token.
    [WIDGET_TEMPLATE_TOKENS.manifest, JSON.stringify(args.manifest, null, 2)],
  ] as const;
  return replacements.reduce(
    (rendered, [token, value]) => replaceAll(rendered, token, value),
    content,
  );
}

export async function writeWidgetScaffold(effects: TEffects, args: TArgs): Promise<string[]> {
  const templateFiles: Readonly<Record<string, string>> = WIDGET_TEMPLATE_FILES[args.template];
  const changedFiles = Object.keys(templateFiles).filter(
    (path) => args.server || path !== 'server/main.server.ts',
  );

  await effects.mkdir(effects.join(args.cwd, 'ui'), { recursive: true });
  // Keep the optional server root available to the constrained authoring tools.
  // UI-only snapshots remain server-free because empty directories are ignored.
  await effects.mkdir(effects.join(args.cwd, 'server'), { recursive: true });
  await Promise.all(changedFiles.map(async (path) => {
    await effects.writeFile(
      effects.join(args.cwd, path),
      renderTemplateFile(templateFiles[path]!, args),
      'utf8',
    );
  }));

  return changedFiles;
}
