export type TEslintAgentReport = {
  ok: boolean;
  exitCode: number;
  command: string;
  text: string;
  fingerprint: string;
};

type TEslintJsonMessage = {
  line?: number;
  column?: number;
  ruleId?: string | null;
  message: string;
};

type TEslintJsonFile = {
  filePath: string;
  messages: TEslintJsonMessage[];
};

const MAX_MESSAGES = 40;

function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function toRelativePath(rootDir: string, filePath: string): string {
  if (!filePath.startsWith(rootDir)) {
    return normalizeSlashes(filePath);
  }

  return normalizeSlashes(filePath.slice(rootDir.length).replace(/^\/+/, ""));
}

function formatJsonReport(rootDir: string, command: string, files: TEslintJsonFile[]): string {
  const lines = [
    "functional-core ESLint failed after the agent turn.",
    `command: ${command}`,
    "",
    "Fix these violations without disabling rules unless there is an explicit reason.",
  ];

  let count = 0;

  for (const file of files) {
    const messages = file.messages.filter((message) => message.ruleId?.startsWith("functional-core/") || message.ruleId === null);
    if (messages.length === 0) continue;

    lines.push("");
    lines.push(`[${toRelativePath(rootDir, file.filePath)}]`);

    for (const message of messages) {
      count += 1;
      if (count > MAX_MESSAGES) {
        lines.push(`- output truncated after ${MAX_MESSAGES} messages; run ${command} for full details`);
        return lines.join("\n");
      }

      const location = message.line && message.column ? `${message.line}:${message.column}` : "?:?";
      const rule = message.ruleId ?? "eslint";
      lines.push(`- ${location} ${rule}: ${message.message}`);
    }
  }

  return lines.join("\n");
}

function formatRawReport(command: string, stdout: string, stderr: string): string {
  const raw = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim();
  return [
    "functional-core ESLint failed after the agent turn.",
    `command: ${command}`,
    "",
    raw || "ESLint failed without output.",
  ].join("\n");
}

async function readProcessText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return await new Response(stream).text();
}

export async function runFunctionalCoreEslint(rootDir: string): Promise<TEslintAgentReport> {
  const command = "bun run lint:functional-core";
  const process = Bun.spawn(["bun", "run", "lint:functional-core", "--", "--format", "json"], {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readProcessText(process.stdout),
    readProcessText(process.stderr),
    process.exited,
  ]);

  if (exitCode === 0) {
    return {
      ok: true,
      exitCode,
      command,
      text: "",
      fingerprint: "",
    };
  }

  try {
    const parsed = JSON.parse(stdout) as TEslintJsonFile[];
    const text = formatJsonReport(rootDir, command, parsed);
    return {
      ok: false,
      exitCode,
      command,
      text,
      fingerprint: text,
    };
  } catch {
    const text = formatRawReport(command, stdout, stderr);
    return {
      ok: false,
      exitCode,
      command,
      text,
      fingerprint: text,
    };
  }
}
