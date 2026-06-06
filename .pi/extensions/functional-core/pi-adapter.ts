import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getFunctionalCoreCheckDefinition, type TFunctionalCoreKind } from "./core/checks";
import {
  buildFunctionalCoreRulesPrompt,
  formatFunctionalCoreViolations,
  isFunctionalCoreFilePath,
  stripToolPathPrefix,
  validateFunctionalCoreFileContent,
} from "./core/checks";
import { buildEditedContentPreview, type TEditInput } from "./core/edit-preview";
import { recordBlockedToolCall } from "./lib/blocked-tool-log";

type TWriteInput = {
  path: string;
  content: string;
};

function resolveToolPath(cwd: string, filePath: string): string {
  return path.resolve(cwd, stripToolPathPrefix(filePath));
}

export function registerFunctionalCorePiCheck(pi: ExtensionAPI, kind: TFunctionalCoreKind): void {
  const definition = getFunctionalCoreCheckDefinition(kind);

  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt: event.systemPrompt + buildFunctionalCoreRulesPrompt(kind),
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") {
      return undefined;
    }

    const input = event.input as Partial<TWriteInput & TEditInput>;
    if (typeof input.path !== "string" || !isFunctionalCoreFilePath(kind, input.path)) {
      return undefined;
    }

    const absolutePath = resolveToolPath(ctx.cwd, input.path);
    async function block(reason: string) {
      await recordBlockedToolCall(ctx.cwd, {
        checkName: definition.checkName,
        toolName: event.toolName,
        cwd: ctx.cwd,
        filePath: input.path ?? absolutePath,
        absolutePath,
        reason,
        input: event.input,
        createdAt: new Date().toISOString(),
      });
      return { block: true, reason };
    }

    let nextContent: string | undefined;
    let buildError: string | undefined;

    if (event.toolName === "write") {
      if (typeof input.content !== "string") {
        return block(`${definition.checkName} could not validate write: missing content`);
      }
      nextContent = input.content;
    }

    if (event.toolName === "edit") {
      if (!Array.isArray(input.edits)) {
        return block(`${definition.checkName} could not validate edit: missing edits`);
      }
      const result = await buildEditedContentPreview(absolutePath, input as TEditInput, definition.checkName);
      nextContent = result.content;
      buildError = result.error;
    }

    if (buildError) {
      if (ctx.hasUI) {
        ctx.ui.notify(buildError, "warning");
      }
      return { block: true, reason: buildError };
    }

    if (typeof nextContent !== "string") {
      return block(`${definition.checkName} could not validate file content`);
    }

    const violations = validateFunctionalCoreFileContent(kind, absolutePath, nextContent);
    if (violations.length === 0) {
      return undefined;
    }

    const reason = formatFunctionalCoreViolations(kind, input.path, violations, nextContent);
    if (ctx.hasUI) {
      ctx.ui.notify(`${definition.checkName} blocked ${input.path}`, "warning");
    }
    return block(reason);
  });
}
