import { existsSync, lstatSync, readdirSync, rmSync, rmdirSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { createInterface } from 'readline/promises';
import { parseArgs } from 'util';
import type { ICliConfig } from '../../../config';
import { fnBuildUninstallPlan, type TUninstallPlan } from '../core/fn.uninstall-plan';
import { txRemoveEmptyDirs, txRemoveUninstallTargets } from '../core/tx.uninstall';

type TRunUninstallArgs = {
  config: ICliConfig;
};

function printUninstallHelp(): void {
  console.log(`Usage: vibecanvas uninstall [options]

Options:
  --yes, -y            Skip confirmation
  --dry-run            Show what would be removed without deleting
  --help, -h           Show this help message
`);
}

function formatKind(kind: string): string {
  return kind.replaceAll('-', ' ');
}

function printPlan(plan: TUninstallPlan, dryRun: boolean): void {
  console.log(dryRun ? '[Uninstall] Dry-run, no files will be deleted.' : '[Uninstall] Vibecanvas will remove:');
  for (const target of plan.removeTargets) {
    console.log(`  - ${formatKind(target.kind)}: ${target.path}`);
  }

  if (plan.skippedTargets.length === 0) return;

  console.log('[Uninstall] Skipping:');
  for (const target of plan.skippedTargets) {
    console.log(`  - ${formatKind(target.kind)}: ${target.path} (${target.reason})`);
  }
}

async function confirmUninstall(): Promise<boolean> {
  if (!process.stdin.isTTY) return false;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('Type "uninstall vibecanvas" to continue: ');
    return answer.trim() === 'uninstall vibecanvas';
  } finally {
    rl.close();
  }
}

async function txCmdUninstall(args: TRunUninstallArgs): Promise<void> {
  const { values } = parseArgs({
    args: args.config.rawArgv,
    strict: false,
    allowPositionals: true,
    options: {
      yes: {
        type: 'boolean',
        short: 'y',
        default: false,
      },
      'dry-run': {
        type: 'boolean',
        default: false,
      },
      help: {
        type: 'boolean',
        short: 'h',
        default: false,
      },
    },
  });

  if (values.help) {
    printUninstallHelp();
    process.exit(0);
  }

  const dryRun = Boolean(values['dry-run']);
  const plan = fnBuildUninstallPlan({ dirname, join, resolve }, {
    homedir: homedir(),
    env: process.env,
    execPath: process.execPath,
    dbPath: args.config.dbPath,
    xdgPaths: args.config.xdgPaths,
  });

  printPlan(plan, dryRun);

  if (dryRun) {
    process.exit(0);
  }

  if (!values.yes) {
    console.log('[Uninstall] This deletes local Vibecanvas config, data, state, and cache.');
    const confirmed = await confirmUninstall();
    if (!confirmed) {
      console.error('[Uninstall] Cancelled. Pass --yes to run non-interactively.');
      process.exit(1);
    }
  }

  const removal = txRemoveUninstallTargets({ existsSync, lstatSync, readdirSync, rmSync, rmdirSync }, {
    paths: plan.removeTargets.map((target) => target.path),
  });
  const emptyDirRemoval = txRemoveEmptyDirs({ existsSync, lstatSync, readdirSync, rmSync, rmdirSync }, {
    paths: [plan.installRoot],
  });

  for (const path of [...removal.removed, ...emptyDirRemoval.removed]) {
    console.log(`[Uninstall] Removed ${path}`);
  }

  for (const failure of [...removal.failed, ...emptyDirRemoval.failed]) {
    console.error(`[Uninstall] Failed to remove ${failure.path}: ${failure.message}`);
  }

  if (removal.failed.length > 0 || emptyDirRemoval.failed.length > 0) {
    process.exit(1);
  }

  console.log('[Uninstall] Complete.');
  console.log('[Uninstall] Shell profile PATH entries are not edited automatically.');
  process.exit(0);
}

export { txCmdUninstall };
