import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const PAIR_PROGRAMMING_PREFIX = `You are now pair-programming with the user.

Mode:
- The user will provide task instructions, usually like a plan.
- You are free to read/inspect any repository content you need, including files, directories, and search results.
- Do not ask the user to paste file contents or snippets that you can inspect yourself.
- Reading/inspecting context is not considered taking over.
- Do not edit files or run mutating tools unless the user explicitly asks you to take over.
- Drive the user step by step: inspect needed context yourself, explain the next small edit/action they should do, then wait for their result.
- Keep messages concise and practical.
- After every assistant message, start with a compact progress overview before the guidance.
- Keep the overview short to avoid wasting space.

Progress overview format:
✅ done item
✅ done item
⬜ current/next item

Then continue with the next instruction.

User's task instructions:`;

type TResolvedFileLink = {
	path: string;
	content: string;
};

function parseArgumentTokens(input: string): string[] {
	const matches = input.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g);
	return Array.from(matches, (match) => match[1] ?? match[2] ?? match[3] ?? "");
}

function normalizeFileLink(token: string, cwd: string): string | undefined {
	const withoutPrefix = token.startsWith("@") ? token.slice(1) : token;
	let withoutFileProtocol = withoutPrefix;

	if (withoutPrefix.startsWith("file://")) {
		try {
			withoutFileProtocol = decodeURIComponent(new URL(withoutPrefix).pathname);
		} catch {
			return undefined;
		}
	}

	const path = withoutFileProtocol.replace(/[),.;:]+$/g, "");

	if (!path || (path === token && !path.includes("/") && !path.startsWith("."))) {
		return undefined;
	}

	return resolve(cwd, path);
}

async function tryReadFileLink(path: string): Promise<TResolvedFileLink | undefined> {
	try {
		const info = await stat(path);

		if (!info.isFile()) {
			return undefined;
		}

		return {
			path,
			content: await readFile(path, "utf8"),
		};
	} catch {
		return undefined;
	}
}

async function resolveFileLinks(input: string, cwd: string): Promise<TResolvedFileLink[]> {
	const candidates = parseArgumentTokens(input)
		.map((token) => normalizeFileLink(token, cwd))
		.filter((path): path is string => Boolean(path));

	const uniqueCandidates = Array.from(new Set(candidates));
	const files = await Promise.all(uniqueCandidates.map((path) => tryReadFileLink(path)));

	return files.filter((file): file is TResolvedFileLink => Boolean(file));
}

function formatPromptWithFileLinks(prompt: string, files: TResolvedFileLink[]): string {
	if (files.length === 0) {
		return prompt;
	}

	const fileContents = files
		.map((file) => `--- ${file.path} ---\n${file.content}`)
		.join("\n\n");

	return `${prompt}\n\nReferenced file contents:\n\n${fileContents}`;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("pairprogramming", {
		description: "Start a pair-programming session where the assistant guides your edits step by step",
		handler: async (args, ctx) => {
			const prompt = args.trim();

			if (!prompt) {
				ctx.ui.notify("Usage: /pairprogramming <task, plan, or file link>", "warning");
				return;
			}

			const files = await resolveFileLinks(prompt, ctx.cwd);
			const taskInstructions = formatPromptWithFileLinks(prompt, files);
			const message = `${PAIR_PROGRAMMING_PREFIX}\n\n${taskInstructions}`;

			if (ctx.isIdle()) {
				pi.sendUserMessage(message);
				return;
			}

			pi.sendUserMessage(message, { deliverAs: "followUp" });
			ctx.ui.notify("Pair-programming prompt queued as a follow-up", "info");
		},
	});
}
