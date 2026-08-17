import { createHash } from 'node:crypto';
import { join } from 'node:path';

type TArgs = Readonly<{
  tmpdir: string;
  homeDir: string;
}>;

export function fnWidgetNpmScratchRoot(args: TArgs): string {
  return join(
    args.tmpdir,
    `omnidraw-widget-npm-${createHash('sha256').update(args.homeDir).digest('hex').slice(0, 12)}`,
  );
}
