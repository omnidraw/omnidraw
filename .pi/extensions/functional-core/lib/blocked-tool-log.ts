import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

type TBlockedToolLogEntry = {
  checkName: string;
  toolName: "write" | "edit";
  cwd: string;
  filePath: string;
  absolutePath: string;
  reason: string;
  input: unknown;
  createdAt: string;
};

function getBlockedToolLogPath(cwd: string): string {
  return path.join(cwd, ".pi", "logs", "functional-core-blocked-tool-calls.jsonl");
}

export async function recordBlockedToolCall(cwd: string, entry: TBlockedToolLogEntry): Promise<void> {
  const logPath = getBlockedToolLogPath(cwd);
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}
