# DB Service

uses drizzle orm and sqlite. exposes helper methods.
consumers should not have to deal with drizzle

## Migrations
Source is `src/schema.ts`

Use `bun run db:generate` to generate migration file.
Use `bun run db:migrate` to apply migrations.
