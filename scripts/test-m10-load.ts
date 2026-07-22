import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type TAcceptanceCase = Readonly<{
  directory?: string;
  file: string;
  name: string;
  runner?: 'bun-test' | 'package-test';
  timeoutMs?: number;
}>;

const REPO_ROOT = resolve(import.meta.dir, '..');
const DEFAULT_TIMEOUT_MS = 120_000;
const cases: readonly TAcceptanceCase[] = [
  {
    file: 'packages/resource-runtime/tests/resource-handle-load.test.ts',
    name: 'bounds KV handles across many inactive resources, evicts LRU handles, and idle-closes to zero',
  },
  {
    file: 'packages/resource-runtime/tests/resource-handle-load.test.ts',
    name: 'bounds DbResource handles across many inactive resources, evicts LRU handles, and idle-closes to zero',
  },
  {
    file: 'apps/cli/tests/TenantServicePool.test.ts',
    name: 'lets a separate organization progress while one organization operation is blocked',
  },
  {
    file: 'apps/cli/tests/WidgetRuntimeLoadAdmission.test.ts',
    name: 'enforces and reclaims the production 64 global and 32 organization cleanup limits',
  },
  {
    directory: 'packages/ui-ai-chat',
    file: 'tests/widget/neutral-widget-host-10k.test.ts',
    name: '10,000 committed widget instances use bounded production UI realms without backend starts',
    runner: 'package-test',
  },
  {
    file: 'packages/function-runtime/tests/local-runtime.test.ts',
    name: 'executes one exact revision and tears down to zero PID/RSS/cwd',
  },
  {
    file: 'packages/service-automerge/tests/websocket.adapter.test.ts',
    name: 'enforces the global connection ceiling and releases capacity on close',
  },
  {
    file: 'packages/service-automerge/tests/websocket.adapter.test.ts',
    name: 'isolates per-organization connection ceilings and releases organization capacity',
  },
  {
    file: 'packages/service-automerge/tests/websocket.adapter.test.ts',
    name: 'replaces peers through a reconnect burst without retaining stale sockets',
  },
];

function xmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function assertStructuredResult(
  acceptanceCase: TAcceptanceCase,
  reportPath: string,
): Promise<void> {
  const report = await readFile(reportPath, 'utf8');
  if (acceptanceCase.runner === 'package-test') {
    const result = JSON.parse(report) as {
      numTotalTests: number;
      numPassedTests: number;
      success: boolean;
      testResults: Array<{
        assertionResults: Array<{ fullName: string; status: string }>;
      }>;
    };
    const assertions = result.testResults.flatMap((testResult) => testResult.assertionResults);
    if (
      !result.success
      || result.numTotalTests !== 1
      || result.numPassedTests !== 1
      || assertions.length !== 1
      || assertions[0]?.fullName !== acceptanceCase.name
      || assertions[0]?.status !== 'passed'
    ) {
      throw new Error(`M10 load case produced an inexact Vitest result: ${acceptanceCase.name}`);
    }
    return;
  }

  const suite = report.match(/<testsuites\s+[^>]*>/)?.[0] ?? '';
  const attribute = (name: string) => Number.parseInt(
    new RegExp(`\\b${name}="(\\d+)"`).exec(suite)?.[1] ?? '-1',
    10,
  );
  const exactName = `name="${xmlAttribute(acceptanceCase.name)}"`;
  const exactCases = [...report.matchAll(/<testcase\s+[^>]*>/g)]
    .map((match) => match[0])
    .filter((testCase) => testCase.includes(exactName));
  if (
    attribute('failures') !== 0
    || attribute('tests') - attribute('skipped') !== 1
    || exactCases.length !== 1
  ) {
    throw new Error(`M10 load case produced an inexact Bun JUnit result: ${acceptanceCase.name}`);
  }
}

async function runCase(
  acceptanceCase: TAcceptanceCase,
  reportPath: string,
): Promise<void> {
  console.log(`\n[m10-load] ${acceptanceCase.name}`);
  const command = acceptanceCase.runner === 'package-test'
    ? [
        process.execPath,
        'run',
        '--cwd',
        acceptanceCase.directory!,
        'test',
        '--',
        acceptanceCase.file,
        '-t',
        acceptanceCase.name,
        '--reporter=json',
        `--outputFile=${reportPath}`,
      ]
    : [
        process.execPath,
        'test',
        acceptanceCase.file,
        '-t',
        acceptanceCase.name,
        '--reporter=junit',
        `--reporter-outfile=${reportPath}`,
      ];
  const child = Bun.spawn(command, {
    cwd: REPO_ROOT,
    env: { ...process.env, FORCE_COLOR: '0' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdoutPromise = new Response(child.stdout).text();
  const stderrPromise = new Response(child.stderr).text();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill(9);
  }, acceptanceCase.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const exitCode = await child.exited;
  clearTimeout(timeout);
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  if (stdout.length > 0) process.stdout.write(stdout);
  if (stderr.length > 0) process.stderr.write(stderr);

  if (timedOut) throw new Error(`M10 load case timed out: ${acceptanceCase.name}`);
  if (exitCode !== 0) throw new Error(`M10 load case failed: ${acceptanceCase.name}`);
  await assertStructuredResult(acceptanceCase, reportPath);
}

const reportRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-m10-load-reports-'));
try {
  for (const [index, acceptanceCase] of cases.entries()) {
    await runCase(
      acceptanceCase,
      join(reportRoot, `${String(index).padStart(2, '0')}.report`),
    );
  }
  console.log(`\n[m10-load] all ${cases.length} required load and isolation cases passed`);
} finally {
  await rm(reportRoot, { recursive: true, force: true });
}
