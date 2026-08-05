/**
 * @file Dev-only retirement of the obsolete agent-private widget draft root.
 */

type TPortal = {
  readdirSync(path: string): string[];
  mkdirSync(path: string, options: { recursive: true }): unknown;
  renameSync(from: string, to: string): void;
  join(...parts: string[]): string;
};

type TArgs = {
  agentRoot: string;
  trashRoot: string;
  token: string;
};

/**
 * Development cleanup, not a migration: the agent draft root moved to the
 * shared widgets/drafts root. Any obsolete agent-private draft folders are
 * moved aside into the widget trash so a developer can inspect or delete them.
 */
export function txRetireLegacyAgentDrafts(portal: TPortal, args: TArgs): boolean {
  const legacy = portal.join(args.agentRoot, 'pi', 'agent', 'widgets', 'drafts');
  let entries: string[];
  try {
    entries = portal.readdirSync(legacy);
  } catch {
    return false;
  }
  if (entries.length === 0) return false;
  portal.mkdirSync(args.trashRoot, { recursive: true });
  portal.renameSync(legacy, portal.join(args.trashRoot, `legacy-agent-drafts-${args.token}`));
  return true;
}
