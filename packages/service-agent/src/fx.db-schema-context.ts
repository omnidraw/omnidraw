import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TActorServiceReloader } from './core/types';

export type TPortal = {
  getDbSchemaContext?: TActorServiceReloader['getDbSchemaContext'];
};

export type TArgs = {
  manifest: TVibecanvasJson;
};

export async function fxBuildDbSchemaContextPrompt(portal: TPortal, args: TArgs): Promise<string> {
  if (!portal.getDbSchemaContext) return '';
  const requirements = Object.values(args.manifest.actor.resources ?? {})
    .flatMap((requirement) => requirement.kind === 'db' ? [requirement] : []);
  const uniqueRequirements = [...new Map(requirements.map((requirement) => [
    `${requirement.schema.id}@${requirement.schema.version}`,
    requirement,
  ])).values()];
  if (uniqueRequirements.length === 0) return '';

  const sections = await Promise.all(uniqueRequirements.map(async (requirement) => {
    const context = await portal.getDbSchemaContext!(requirement.schema.id, requirement.schema.version);
    if (!context) {
      return `## ${requirement.schema.id}@${requirement.schema.version}\nPublished schema context is unavailable. Do not invent tables or migration history.`;
    }
    const migrations = context.migrations.map((migration) => [
      `### Migration ${migration.version}: ${migration.name}`,
      `Checksum: ${migration.checksum}`,
      'Exact SQL as a JSON string (decode JSON escapes before reasoning about bytes):',
      JSON.stringify(migration.sql),
    ].join('\n')).join('\n\n');
    return [
      `## ${context.schema.id}@${requirement.schema.version} — ${context.schema.name}`,
      context.schema.description ?? '',
      migrations.length > 0 ? migrations : 'Version 0 has no host migrations.',
    ].filter((line) => line.length > 0).join('\n\n');
  }));

  return [
    '# Host-published DbResource schema context',
    'Use only this complete published migration history through each declared version to derive local actor row/query types. Do not run these migrations from actor code.',
    ...sections,
  ].join('\n\n');
}
