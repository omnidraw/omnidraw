import path from "node:path";
import { RUNTIME_GLOBAL_BLOCK_NOTE, validateNoDirectRuntimeGlobals } from "./runtime-global-usage";
import {
  getLineNumber,
  maskComments,
  maskCommentsAndStrings,
  splitNamedSpecifiers,
  splitTopLevelParams,
  type TDeclKind,
} from "./text";

export type TFunctionalCoreKind = "fn" | "fx" | "tx";

export type TCheckDefinition = {
  kind: TFunctionalCoreKind;
  checkName: string;
  fileLabel: string;
  fileRe: RegExp;
  testFileRe: RegExp;
  allowedRuntimeImportPrefixes: string[];
  rules: readonly string[];
};

const TYPE_IMPORT_INLINE_ADVICE =
  " If this is a type or interface, you probably want `import type`.";
const INSTANCEOF_GUARDS_INLINE_ADVICE =
  " Use `GUARDS.ts` when this runtime import is only needed for `instanceof` or identity checks.";
const INSTANCEOF_GUARDS_BLOCK_NOTE = [
  "instanceof note:",
  "- if you need runtime class/value imports for `instanceof` or identity checks, move that logic into `GUARDS.ts` and import the guard from there",
  "- `GUARDS.ts` runtime imports are allowed from fn.*, fx.*, and tx.* files",
].join("\n");

const ALLOWED_CONSTANT_LIKE_IMPORT_NAME_RE = /^[A-Z0-9_]+$/;

export const FN_CHECK_RULES = [
  "ignore fn.*.test.ts files",
  "exported functions must start with fn",
  "imports must be type-only unless imported module leaf starts with fn., fx., or tx., is exactly CONSTANTS or GUARDS, or the imported runtime binding name is UPPER_CASE / underscore style",
  "CONSTANTS.ts and GUARDS.ts imports are allowed for shared local constants and runtime guards",
  "UPPER_CASE runtime value imports like THEME_STROKE_WIDTH_VALUE_MAP are allowed from any module",
  "no direct use of runtime globals like window, fetch, Bun, process, console, globalThis",
  "do not export classes or other runtime values; only functions and types",
  "portal and args params are optional in fn.*.ts files",
] as const;

export const FX_CHECK_RULES = [
  "ignore fx.*.test.ts files",
  "exported functions must start with fx",
  "imports must be type-only unless imported module leaf starts with fn., fx., is exactly CONSTANTS or GUARDS, or the imported runtime binding name is UPPER_CASE / underscore style",
  "CONSTANTS.ts and GUARDS.ts imports are allowed for shared local constants and runtime guards",
  "UPPER_CASE runtime value imports like THEME_STROKE_WIDTH_VALUE_MAP are allowed from any module",
  "no direct use of runtime globals like window, fetch, Bun, process, console, globalThis",
  "do not export classes or other runtime values; only functions and types",
  "every fx* function must have 1 or 2 params: required portal, optional args",
  "first param must be named portal and typed as TPortal*",
  "second param is optional; when present, it must be named args and typed; inline arg types are allowed",
  "TPortal may hold side effects and mutable services objects",
  "TArgs is usually serializable payload data",
  "fx is for impure reads; use brain and prefer tx for impure writes",
] as const;

export const TX_CHECK_RULES = [
  "ignore tx.*.test.ts files",
  "exported functions must start with tx",
  "imports must be type-only unless imported module leaf starts with fn., fx., or tx., is exactly CONSTANTS or GUARDS, or the imported runtime binding name is UPPER_CASE / underscore style",
  "CONSTANTS.ts and GUARDS.ts imports are allowed for shared local constants and runtime guards",
  "UPPER_CASE runtime value imports like THEME_STROKE_WIDTH_VALUE_MAP are allowed from any module",
  "no direct use of runtime globals like window, fetch, Bun, process, console, globalThis",
  "do not export classes or other runtime values; only functions and types",
  "every tx* function must have 1 or 2 params: required portal, optional args",
  "first param must be named portal and typed as TPortal*",
  "second param is optional; when present, it must be named args and typed; inline arg types are allowed",
  "TPortal may hold side effects and mutable services objects",
  "TArgs is usually serializable payload data",
  "tx is for impure writes; use brain and prefer tx when code changes external world state",
  "tx may runtime-import fn.*, fx.*, tx.*, CONSTANTS, and GUARDS",
] as const;

const CHECK_DEFINITIONS: Record<TFunctionalCoreKind, TCheckDefinition> = {
  fn: {
    kind: "fn",
    checkName: "fn-check",
    fileLabel: "fn.*.ts",
    fileRe: /^fn\..+\.ts$/,
    testFileRe: /^fn\..+\.test\.ts$/,
    allowedRuntimeImportPrefixes: ["fn", "fx", "tx"],
    rules: FN_CHECK_RULES,
  },
  fx: {
    kind: "fx",
    checkName: "fx-check",
    fileLabel: "fx.*.ts",
    fileRe: /^fx\..+\.ts$/,
    testFileRe: /^fx\..+\.test\.ts$/,
    allowedRuntimeImportPrefixes: ["fn", "fx"],
    rules: FX_CHECK_RULES,
  },
  tx: {
    kind: "tx",
    checkName: "tx-check",
    fileLabel: "tx.*.ts",
    fileRe: /^tx\..+\.ts$/,
    testFileRe: /^tx\..+\.test\.ts$/,
    allowedRuntimeImportPrefixes: ["fn", "fx", "tx"],
    rules: TX_CHECK_RULES,
  },
};

export function stripToolPathPrefix(filePath: string): string {
  return filePath.startsWith("@") ? filePath.slice(1) : filePath;
}

export function getFunctionalCoreCheckDefinition(kind: TFunctionalCoreKind): TCheckDefinition {
  return CHECK_DEFINITIONS[kind];
}

export function isFunctionalCoreFilePath(kind: TFunctionalCoreKind, filePath: string): boolean {
  const definition = getFunctionalCoreCheckDefinition(kind);
  const baseName = path.basename(stripToolPathPrefix(filePath));
  if (definition.testFileRe.test(baseName)) return false;
  return definition.fileRe.test(baseName);
}

export function getFunctionalCoreKindForPath(filePath: string): TFunctionalCoreKind | undefined {
  for (const kind of Object.keys(CHECK_DEFINITIONS) as TFunctionalCoreKind[]) {
    if (isFunctionalCoreFilePath(kind, filePath)) {
      return kind;
    }
  }

  return undefined;
}

export function buildFunctionalCoreRulesPrompt(kind: TFunctionalCoreKind): string {
  const definition = getFunctionalCoreCheckDefinition(kind);
  return `\n\n## ${definition.checkName}\nWhen editing or writing any ${definition.fileLabel} file, obey these rules:\n${definition.rules.map((rule) => `- ${rule}`).join("\n")}\n`;
}

export function buildFunctionalCoreRulesOverview(): string {
  return [
    "[RULES OVERVIEW]",
    "[fn.*.ts]",
    ...FN_CHECK_RULES.map((rule) => `- ${rule}`),
    "",
    "[fx.*.ts]",
    ...FX_CHECK_RULES.map((rule) => `- ${rule}`),
    "",
    "[tx.*.ts]",
    ...TX_CHECK_RULES.map((rule) => `- ${rule}`),
  ].join("\n");
}

export function formatFunctionalCoreViolations(
  kind: TFunctionalCoreKind,
  filePath: string,
  violations: string[],
  content: string,
): string {
  const definition = getFunctionalCoreCheckDefinition(kind);
  const instanceofNote = hasInstanceofUsage(content) ? [INSTANCEOF_GUARDS_BLOCK_NOTE] : [];

  return [
    `${definition.checkName} blocked ${filePath}`,
    "what went wrong:",
    ...violations.map((violation) => `- ${violation}`),
    ...instanceofNote,
    RUNTIME_GLOBAL_BLOCK_NOTE,
    "rules:",
    ...definition.rules.map((rule) => `- ${rule}`),
  ].join("\n");
}

export function validateFunctionalCoreFileContent(
  kind: TFunctionalCoreKind,
  filePath: string,
  content: string,
): string[] {
  const definition = getFunctionalCoreCheckDefinition(kind);
  const errors = [
    ...validateImports(definition, content),
    ...validateExports(definition, content),
    ...validateNoDirectRuntimeGlobals(content, definition.fileLabel),
    ...validateFunctionParams(definition, content),
  ];

  return errors.map((error) => `${path.basename(filePath)}: ${error}`);
}

export function isFnFilePath(filePath: string): boolean {
  return isFunctionalCoreFilePath("fn", filePath);
}

export function isFxFilePath(filePath: string): boolean {
  return isFunctionalCoreFilePath("fx", filePath);
}

export function isTxFilePath(filePath: string): boolean {
  return isFunctionalCoreFilePath("tx", filePath);
}

export function validateFnFileContent(filePath: string, content: string): string[] {
  return validateFunctionalCoreFileContent("fn", filePath, content);
}

export function validateFxFileContent(filePath: string, content: string): string[] {
  return validateFunctionalCoreFileContent("fx", filePath, content);
}

export function validateTxFileContent(filePath: string, content: string): string[] {
  return validateFunctionalCoreFileContent("tx", filePath, content);
}

function getModuleLeaf(modulePath: string): string {
  const clean = modulePath.replace(/\\/g, "/").replace(/\.(cts|mts|ts|tsx|js|jsx)$/, "");
  const parts = clean.split("/").filter(Boolean);
  return parts.at(-1) ?? clean;
}

function isAllowedConstantsImport(modulePath: string): boolean {
  return getModuleLeaf(modulePath) === "CONSTANTS";
}

function isAllowedGuardsImport(modulePath: string): boolean {
  return getModuleLeaf(modulePath) === "GUARDS";
}

function isAllowedRuntimeImport(definition: TCheckDefinition, modulePath: string): boolean {
  const leaf = getModuleLeaf(modulePath);
  return definition.allowedRuntimeImportPrefixes.some((prefix) => leaf.startsWith(`${prefix}.`));
}

function isAllowedConstantLikeImportName(name: string): boolean {
  return ALLOWED_CONSTANT_LIKE_IMPORT_NAME_RE.test(name.trim());
}

function hasInstanceofUsage(content: string): boolean {
  return /\binstanceof\b/.test(maskCommentsAndStrings(content));
}

function getImportAdvice(definition: TCheckDefinition, modulePath: string, usesInstanceof: boolean): string {
  if (definition.kind !== "fx") {
    return usesInstanceof ? INSTANCEOF_GUARDS_INLINE_ADVICE : "";
  }

  const advice: string[] = [];

  if (modulePath === "solid-js" || modulePath.startsWith("solid-js/")) {
    advice.push(
      "Consider moving this UI/orchestration code out of fx.*.ts, or rename/split the file so the runtime UI layer is not inside fx.*.",
    );
  }

  if (
    modulePath === "fs" ||
    modulePath === "path" ||
    modulePath.startsWith("node:fs") ||
    modulePath.startsWith("node:path") ||
    modulePath.includes("drizzle-orm")
  ) {
    advice.push(
      "Consider moving this to tx.*.ts or another shell/orchestration layer; fx.*.ts should avoid runtime fs/path/db migration imports.",
    );
  }

  if (getModuleLeaf(modulePath).startsWith("tx.")) {
    advice.push(
      "fx.*.ts should avoid runtime tx.* imports; consider splitting read/write responsibilities or moving orchestration into tx.*.ts.",
    );
  }

  if (usesInstanceof) {
    advice.push(INSTANCEOF_GUARDS_INLINE_ADVICE.trim());
  }

  return advice.length === 0 ? "" : ` ${advice.join(" ")}`;
}

function validateImports(definition: TCheckDefinition, content: string): string[] {
  const errors: string[] = [];
  const clean = maskComments(content);
  const usesInstanceof = hasInstanceofUsage(content);
  const importRe = /(^|\n)\s*import\s+([\s\S]*?)\s+from\s+(['"])(.*?)\3\s*;?/g;

  for (const match of clean.matchAll(importRe)) {
    const clause = match[2]?.trim() ?? "";
    const modulePath = match[4] ?? "";
    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    const line = getLineNumber(clean, start);
    const advice = getImportAdvice(definition, modulePath, usesInstanceof);

    if (!clause || clause.startsWith("type ")) continue;
    if (isAllowedRuntimeImport(definition, modulePath)) continue;
    if (isAllowedConstantsImport(modulePath)) continue;
    if (isAllowedGuardsImport(modulePath)) continue;

    const namedMatch = clause.match(/\{([\s\S]*)\}/);
    const beforeNamed = namedMatch ? clause.slice(0, namedMatch.index).replace(/,/g, "").trim() : clause;
    const hasDefaultImport = !!beforeNamed && !beforeNamed.startsWith("*");
    const hasNamespaceImport = /\*\s+as\s+[A-Za-z_$][\w$]*/.test(clause);

    if (hasDefaultImport) {
      const defaultImportName = beforeNamed.split(/\s+/).find(Boolean) ?? "";
      if (!isAllowedConstantLikeImportName(defaultImportName)) {
        errors.push(`line ${line}: runtime default import from \"${modulePath}\" not allowed in ${definition.fileLabel}.${TYPE_IMPORT_INLINE_ADVICE}${advice}`);
      }
    }

    if (hasNamespaceImport) {
      const namespaceImportName = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)?.[1] ?? "";
      if (!isAllowedConstantLikeImportName(namespaceImportName)) {
        errors.push(`line ${line}: runtime namespace import from \"${modulePath}\" not allowed in ${definition.fileLabel}.${TYPE_IMPORT_INLINE_ADVICE}${advice}`);
      }
    }

    if (namedMatch) {
      for (const specifier of splitNamedSpecifiers(namedMatch[1] ?? "")) {
        if (specifier.startsWith("type ")) continue;
        const importedName = specifier.split(/\s+as\s+/i).at(-1) ?? specifier;
        if (isAllowedConstantLikeImportName(importedName)) continue;
        errors.push(
          `line ${line}: runtime import \"${importedName.trim()}\" from \"${modulePath}\" not allowed in ${definition.fileLabel}.${TYPE_IMPORT_INLINE_ADVICE}${advice}`,
        );
      }
    }
  }

  return errors;
}

function collectDeclarationKinds(content: string): Map<string, TDeclKind> {
  const clean = maskCommentsAndStrings(content);
  const kinds = new Map<string, TDeclKind>();

  for (const match of clean.matchAll(/(^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[2];
    if (name) kinds.set(name, "function");
  }

  for (const match of clean.matchAll(/(^|\n)\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/g)) {
    const name = match[2];
    if (name) kinds.set(name, "class");
  }

  for (const match of clean.matchAll(/(^|\n)\s*(?:export\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)\b/g)) {
    const name = match[2];
    if (name) kinds.set(name, "type");
  }

  for (const match of clean.matchAll(/(^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?)(?=;|\n)/g)) {
    const name = match[2];
    const init = (match[3] ?? "").trim();
    if (!name) continue;
    const isFunction = /^(async\s+)?function\b/.test(init) || /^(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(init);
    kinds.set(name, isFunction ? "function" : "value");
  }

  for (const match of clean.matchAll(/(^|\n)\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)\b/g)) {
    const name = match[2];
    if (name) kinds.set(name, "value");
  }

  return kinds;
}

function validateExports(definition: TCheckDefinition, content: string): string[] {
  const errors: string[] = [];
  const clean = maskCommentsAndStrings(content);
  const kinds = collectDeclarationKinds(content);

  for (const match of clean.matchAll(/(^|\n)\s*export\s+class\s+([A-Za-z_$][\w$]*)\b/g)) {
    const line = getLineNumber(clean, (match.index ?? 0) + (match[1]?.length ?? 0));
    errors.push(`line ${line}: exported classes not allowed in ${definition.fileLabel}`);
  }

  for (const match of clean.matchAll(/(^|\n)\s*export\s+enum\s+([A-Za-z_$][\w$]*)\b/g)) {
    const line = getLineNumber(clean, (match.index ?? 0) + (match[1]?.length ?? 0));
    errors.push(`line ${line}: exported enum not allowed; export functions or types only`);
  }

  for (const match of clean.matchAll(/(^|\n)\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[2] ?? "";
    const line = getLineNumber(clean, (match.index ?? 0) + (match[1]?.length ?? 0));
    if (!name.startsWith(definition.kind)) {
      errors.push(`line ${line}: exported function must start with ${definition.kind}`);
    }
  }

  for (const match of clean.matchAll(/(^|\n)\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?)(?=;|\n)/g)) {
    const name = match[2] ?? "";
    const init = (match[3] ?? "").trim();
    const line = getLineNumber(clean, (match.index ?? 0) + (match[1]?.length ?? 0));
    const isFunction = /^(async\s+)?function\b/.test(init) || /^(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(init);

    if (!isFunction) {
      errors.push(`line ${line}: exported value \"${name}\" not allowed; export functions or types only`);
      continue;
    }

    if (!name.startsWith(definition.kind)) {
      errors.push(`line ${line}: exported function must start with ${definition.kind}`);
    }
  }

  for (const match of clean.matchAll(/(^|\n)\s*export\s+default\s+(?!function\b)(?!class\b)/g)) {
    const line = getLineNumber(clean, (match.index ?? 0) + (match[1]?.length ?? 0));
    errors.push(`line ${line}: export assignment not allowed in ${definition.fileLabel}`);
  }

  for (const match of clean.matchAll(/(^|\n)\s*export\s*\{([\s\S]*?)\}\s*(?:from\s+['"][^'"]+['"])?\s*;?/g)) {
    const body = match[2] ?? "";
    const line = getLineNumber(clean, (match.index ?? 0) + (match[1]?.length ?? 0));
    const hasFrom = /\}\s*from\s+['"][^'"]+['"]/.test(match[0] ?? "");

    for (const specifier of splitNamedSpecifiers(body)) {
      if (specifier.startsWith("type ")) continue;

      const parts = specifier.replace(/^type\s+/, "").split(/\s+as\s+/i).map((part) => part.trim());
      const localName = parts[0] ?? "";
      const exportedName = parts.at(-1) ?? localName;

      if (hasFrom) {
        if (!exportedName.startsWith(definition.kind)) {
          errors.push(`line ${line}: exported function must start with ${definition.kind}`);
        }
        continue;
      }

      const kind = kinds.get(localName);
      if (kind === "class") {
        errors.push(`line ${line}: exported classes not allowed in ${definition.fileLabel}`);
        continue;
      }
      if (kind === "value") {
        errors.push(`line ${line}: exported value \"${exportedName}\" not allowed; export functions or types only`);
        continue;
      }
      if (kind === "function" && !exportedName.startsWith(definition.kind)) {
        errors.push(`line ${line}: exported function must start with ${definition.kind}`);
      }
    }
  }

  return errors;
}

function validateFunctionParams(definition: TCheckDefinition, content: string): string[] {
  if (definition.kind === "fn") {
    return [];
  }

  const errors: string[] = [];
  const clean = maskCommentsAndStrings(content);
  const signatures: Array<{ name: string; params: string; line: number }> = [];
  const prefix = definition.kind;

  for (const match of clean.matchAll(new RegExp(`(^|\\n)\\s*export\\s+(?:default\\s+)?(?:async\\s+)?function\\s+(${prefix}[A-Za-z_$][\\w$]*)\\s*\\(([^)]*)\\)`, "g"))) {
    signatures.push({
      name: match[2] ?? "",
      params: match[3] ?? "",
      line: getLineNumber(clean, (match.index ?? 0) + (match[1]?.length ?? 0)),
    });
  }

  for (const match of clean.matchAll(new RegExp(`(^|\\n)\\s*export\\s+(?:const|let|var)\\s+(${prefix}[A-Za-z_$][\\w$]*)\\s*=\\s*(?:async\\s*)?(?:function\\s*)?\\(([^)]*)\\)\\s*=>?`, "g"))) {
    signatures.push({
      name: match[2] ?? "",
      params: match[3] ?? "",
      line: getLineNumber(clean, (match.index ?? 0) + (match[1]?.length ?? 0)),
    });
  }

  for (const signature of signatures) {
    const params = splitTopLevelParams(signature.params);
    if (params.length === 0 || params.length > 2) {
      errors.push(`line ${signature.line}: ${signature.name} must take portal first and optional args second`);
      continue;
    }

    const [portalParam, argsParam] = params;
    const portalMatch = portalParam?.match(/^portal\s*:\s*([A-Za-z_$][\w$]*)/);

    if (!portalMatch) {
      errors.push(`line ${signature.line}: ${signature.name} first parameter must be named portal and typed as TPortal*`);
    } else if (!portalMatch[1].startsWith("TPortal")) {
      errors.push(`line ${signature.line}: ${signature.name} portal type must start with TPortal`);
    }

    if (!argsParam) {
      continue;
    }

    const argsMatch = argsParam.match(/^args\??\s*:\s*.+/);

    if (!argsMatch) {
      errors.push(`line ${signature.line}: ${signature.name} second parameter must be named args and have a type`);
    }
  }

  return errors;
}
