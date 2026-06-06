import { maskCommentsAndStrings } from "./text";

const FORBIDDEN_GLOBALS = [
  "globalThis",
  "window",
  "document",
  "navigator",
  "location",
  "localStorage",
  "sessionStorage",
  "fetch",
  "Request",
  "Response",
  "Headers",
  "WebSocket",
  "EventSource",
  "console",
  "process",
  "Bun",
  "Deno",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "queueMicrotask",
  "crypto",
] as const;

const FORBIDDEN_GLOBAL_SET = new Set<string>(FORBIDDEN_GLOBALS);
const IDENTIFIER_RE = /[A-Za-z_$][\w$]*/g;

export const RUNTIME_GLOBAL_BLOCK_NOTE = [
  "runtime-global note:",
  "- blocked: free runtime globals like `crypto.randomUUID()` or `window.location`",
  "- allowed: type-only references like `typeof crypto` or `Request` in types",
  "- allowed: injected access like `portal.crypto.randomUUID()` or `portal.window.location`",
].join("\n");

export function validateNoDirectRuntimeGlobals(content: string, fileLabel: string): string[] {
  const clean = maskCommentsAndStrings(content);
  const runtimeOnly = maskTypeOnlyRegions(clean);
  const declaredNames = collectDeclaredNames(runtimeOnly);
  const errors = new Set<string>();

  for (const match of runtimeOnly.matchAll(IDENTIFIER_RE)) {
    const globalName = match[0] ?? "";
    if (!FORBIDDEN_GLOBAL_SET.has(globalName)) {
      continue;
    }

    const index = match.index ?? 0;
    const nextIndex = index + globalName.length;
    const prevChar = findPrevNonWhitespace(runtimeOnly, index - 1);
    const nextChar = findNextNonWhitespace(runtimeOnly, nextIndex);

    if (declaredNames.has(globalName)) {
      continue;
    }

    if (prevChar === ".") {
      continue;
    }

    if (nextChar === ":") {
      continue;
    }

    const line = getLineNumber(runtimeOnly, index);
    errors.add(
      `line ${line}: direct global \"${globalName}\" not allowed in ${fileLabel}; inject it through portal or another argument. Type-only refs like \"typeof ${globalName}\" and member access like \"portal.${globalName}\" are allowed`,
    );
  }

  return [...errors];
}

function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function findPrevNonWhitespace(content: string, index: number): string {
  for (let current = index; current >= 0; current -= 1) {
    const char = content[current] ?? "";
    if (!/\s/.test(char)) {
      return char;
    }
  }

  return "";
}

function findNextNonWhitespace(content: string, index: number): string {
  for (let current = index; current < content.length; current += 1) {
    const char = content[current] ?? "";
    if (!/\s/.test(char)) {
      return char;
    }
  }

  return "";
}

function collectDeclaredNames(content: string): Set<string> {
  const names = new Set<string>();
  const declarationPatterns = [
    /\b(?:const|let|var|function|class|enum)\s+([A-Za-z_$][\w$]*)/g,
    /\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g,
    /\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g,
    /\bcatch\s*\(([A-Za-z_$][\w$]*)\)/g,
  ];

  for (const pattern of declarationPatterns) {
    for (const match of content.matchAll(pattern)) {
      const raw = match[1] ?? "";
      if (raw) {
        names.add(raw);
      }
    }
  }

  for (const match of content.matchAll(/\bimport\s*\{([^}]*)\}/g)) {
    const raw = match[1] ?? "";
    for (const part of raw.split(",")) {
      const clean = part.trim();
      if (!clean || clean.startsWith("type ")) continue;
      const local = clean.split(/\s+as\s+/i).at(-1)?.trim();
      if (local) names.add(local);
    }
  }

  for (const match of content.matchAll(/\(([^)]*)\)\s*(?::|=>|\{)/g)) {
    const params = match[1] ?? "";
    for (const part of params.split(",")) {
      const param = part.trim();
      const nameMatch = param.match(/^(?:\.\.\.)?([A-Za-z_$][\w$]*)/);
      if (nameMatch?.[1]) {
        names.add(nameMatch[1]);
      }
    }
  }

  for (const match of content.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
    const body = match[1] ?? "";
    for (const part of body.split(",")) {
      const clean = part.trim();
      if (!clean) continue;
      const local = clean.split(":").at(-1)?.trim().match(/^([A-Za-z_$][\w$]*)/)?.[1];
      if (local) names.add(local);
    }
  }

  return names;
}

function maskTypeOnlyRegions(content: string): string {
  let next = content;
  next = maskTypeAliasBodies(next);
  next = maskInterfaceBodies(next);
  return next;
}

function maskTypeAliasBodies(content: string): string {
  const matcher = /\btype\s+[A-Za-z_$][\w$]*(?:\s*<[^\n=]*>)?\s*=/g;
  let next = content;

  for (const match of [...content.matchAll(matcher)].reverse()) {
    const start = (match.index ?? 0) + match[0].length;
    const end = findTypeStatementEnd(content, start);
    next = replaceWithSpaces(next, start, end);
  }

  return next;
}

function maskInterfaceBodies(content: string): string {
  const matcher = /\binterface\s+[A-Za-z_$][\w$]*(?:\s*<[^\n{]*>)?[^\n{]*\{/g;
  let next = content;

  for (const match of [...content.matchAll(matcher)].reverse()) {
    const openBraceIndex = (match.index ?? 0) + match[0].length - 1;
    const end = findMatchingBrace(content, openBraceIndex);
    if (end === -1) {
      continue;
    }
    next = replaceWithSpaces(next, match.index ?? 0, end + 1);
  }

  return next;
}

function findTypeStatementEnd(content: string, start: number): number {
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let depthAngle = 0;

  for (let index = start; index < content.length; index += 1) {
    const char = content[index]!;

    if (char === "(") depthParen += 1;
    if (char === ")") depthParen -= 1;
    if (char === "{") depthBrace += 1;
    if (char === "}") depthBrace -= 1;
    if (char === "[") depthBracket += 1;
    if (char === "]") depthBracket -= 1;
    if (char === "<") depthAngle += 1;
    if (char === ">") depthAngle -= 1;

    if (char === ";" && depthParen === 0 && depthBrace === 0 && depthBracket === 0 && depthAngle === 0) {
      return index;
    }
  }

  return content.length;
}

function findMatchingBrace(content: string, openBraceIndex: number): number {
  let depth = 0;

  for (let index = openBraceIndex; index < content.length; index += 1) {
    const char = content[index]!;

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return index;
    }
  }

  return -1;
}

function replaceWithSpaces(content: string, start: number, end: number): string {
  const masked = content
    .slice(start, end)
    .replace(/[^\n]/g, " ");

  return content.slice(0, start) + masked + content.slice(end);
}
