const ALLOWED_IMPORT_PREFIXES = {
  fn: ["fn", "fx", "tx"],
  fx: ["fn", "fx"],
  tx: ["fn", "fx", "tx"],
};

const FILE_LABELS = {
  fn: "fn.*.ts",
  fx: "fx.*.ts",
  tx: "tx.*.ts",
};

const FORBIDDEN_GLOBALS = new Set([
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
]);

const RUNTIME_GLOBAL_MESSAGE =
  "direct global \"{{name}}\" not allowed in {{fileLabel}}; inject it through portal or another argument";

const UPPER_CASE_RE = /^[A-Z0-9_]+$/;
const TYPE_NODE_PREFIXES = ["TS", "TSType", "TSInterface", "TSTypeAlias"];

function getKind(context) {
  return context.options[0]?.kind;
}

function getFileLabel(kind) {
  return FILE_LABELS[kind] ?? "functional-core file";
}

function getModuleLeaf(modulePath) {
  const clean = modulePath.replace(/\\/g, "/").replace(/\.(cts|mts|ts|tsx|js|jsx)$/, "");
  const parts = clean.split("/").filter(Boolean);
  return parts.at(-1) ?? clean;
}

function isAllowedModule(kind, modulePath) {
  const leaf = getModuleLeaf(modulePath);
  if (leaf === "CONSTANTS" || leaf === "GUARDS") return true;
  return (ALLOWED_IMPORT_PREFIXES[kind] ?? []).some((prefix) => leaf.startsWith(`${prefix}.`));
}

function isUpperCaseName(name) {
  return UPPER_CASE_RE.test(name);
}

function isTypeOnlyImportSpecifier(specifier) {
  return specifier.importKind === "type" || specifier.importKind === "typeof";
}

function isFunctionNode(node) {
  return !!node && (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

function getVariableFunctionNode(declarator) {
  if (!declarator?.init) return undefined;
  return isFunctionNode(declarator.init) ? declarator.init : undefined;
}

function getIdentifierTypeName(param) {
  const annotation = param?.typeAnnotation?.typeAnnotation;
  if (!annotation) return "";
  if (annotation.type === "TSTypeReference") {
    const typeName = annotation.typeName;
    if (typeName?.type === "Identifier") return typeName.name;
  }
  return "";
}

function unwrapParam(param) {
  if (param?.type === "TSParameterProperty") return param.parameter;
  if (param?.type === "AssignmentPattern") return param.left;
  return param;
}

function getParamName(param) {
  const next = unwrapParam(param);
  if (next?.type === "Identifier") return next.name;
  return "";
}

function isTypePosition(node) {
  let current = node.parent;
  while (current) {
    if (TYPE_NODE_PREFIXES.some((prefix) => current.type.startsWith(prefix))) return true;
    if (current.type === "ImportDeclaration" && current.importKind === "type") return true;
    current = current.parent;
  }
  return false;
}

function isPropertyName(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) return true;
  if (parent.type === "Property" && parent.key === node && !parent.computed) return true;
  if (parent.type === "MethodDefinition" && parent.key === node && !parent.computed) return true;
  return false;
}

function isDeclarationIdentifier(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "VariableDeclarator" && parent.id === node) return true;
  if ((parent.type === "FunctionDeclaration" || parent.type === "FunctionExpression") && parent.id === node) return true;
  if ((parent.type === "ClassDeclaration" || parent.type === "ClassExpression") && parent.id === node) return true;
  if (parent.type === "ImportDefaultSpecifier" || parent.type === "ImportNamespaceSpecifier" || parent.type === "ImportSpecifier") return true;
  if (parent.type === "TSTypeAliasDeclaration" && parent.id === node) return true;
  if (parent.type === "TSInterfaceDeclaration" && parent.id === node) return true;
  if (parent.type === "TSEnumDeclaration" && parent.id === node) return true;
  return false;
}

function isObjectPatternKey(node) {
  const parent = node.parent;
  return parent?.type === "Property" && parent.key === node && parent.value !== node;
}

function makeDocs(description) {
  return {
    type: "problem",
    docs: {
      description,
    },
    schema: [
      {
        type: "object",
        properties: {
          kind: { enum: ["fn", "fx", "tx"] },
        },
        additionalProperties: false,
      },
    ],
  };
}

function createImportBoundaryRule(context) {
  const kind = getKind(context);
  const fileLabel = getFileLabel(kind);

  return {
    ImportDeclaration(node) {
      const modulePath = String(node.source.value ?? "");
      if (node.importKind === "type" || isAllowedModule(kind, modulePath)) return;

      for (const specifier of node.specifiers) {
        if (isTypeOnlyImportSpecifier(specifier)) continue;

        const localName = specifier.local?.name ?? "";
        if (isUpperCaseName(localName)) continue;

        const importKind =
          specifier.type === "ImportDefaultSpecifier"
            ? "runtime default import"
            : specifier.type === "ImportNamespaceSpecifier"
              ? "runtime namespace import"
              : `runtime import "${localName}"`;

        context.report({
          node: specifier,
          message: `${importKind} from "${modulePath}" not allowed in ${fileLabel}. If this is a type or interface, use import type.`,
        });
      }
    },
  };
}

function createNoRuntimeGlobalsRule(context) {
  const sourceCode = context.sourceCode;
  const kind = getKind(context);
  const fileLabel = getFileLabel(kind);

  return {
    Identifier(node) {
      if (!FORBIDDEN_GLOBALS.has(node.name)) return;
      if (isDeclarationIdentifier(node) || isObjectPatternKey(node) || isPropertyName(node) || isTypePosition(node)) return;

      const variable = sourceCode.getScope(node).set.get(node.name);
      if (variable) return;

      context.report({
        node,
        message: RUNTIME_GLOBAL_MESSAGE,
        data: {
          name: node.name,
          fileLabel,
        },
      });
    },
  };
}

function createExportShapeRule(context) {
  const kind = getKind(context);
  const fileLabel = getFileLabel(kind);
  const declarations = new Map();

  function rememberDeclaration(node) {
    if (!node) return;
    if (node.type === "FunctionDeclaration" && node.id?.name) declarations.set(node.id.name, "function");
    if (node.type === "ClassDeclaration" && node.id?.name) declarations.set(node.id.name, "class");
    if (node.type === "TSTypeAliasDeclaration" && node.id?.name) declarations.set(node.id.name, "type");
    if (node.type === "TSInterfaceDeclaration" && node.id?.name) declarations.set(node.id.name, "type");
    if (node.type === "TSEnumDeclaration" && node.id?.name) declarations.set(node.id.name, "value");
    if (node.type === "VariableDeclaration") {
      for (const declarator of node.declarations) {
        if (declarator.id?.type === "Identifier") {
          declarations.set(declarator.id.name, getVariableFunctionNode(declarator) ? "function" : "value");
        }
      }
    }
  }

  function checkFunctionName(node, name) {
    if (!name.startsWith(kind)) {
      context.report({
        node,
        message: `exported function must start with ${kind}`,
      });
    }
  }

  function checkDeclaration(node) {
    if (!node) return;
    if (node.type === "FunctionDeclaration") {
      checkFunctionName(node.id ?? node, node.id?.name ?? "");
      return;
    }
    if (node.type === "ClassDeclaration") {
      context.report({ node, message: `exported classes not allowed in ${fileLabel}` });
      return;
    }
    if (node.type === "TSEnumDeclaration") {
      context.report({ node, message: "exported enum not allowed; export functions or types only" });
      return;
    }
    if (node.type === "VariableDeclaration") {
      for (const declarator of node.declarations) {
        if (declarator.id?.type !== "Identifier") continue;
        const name = declarator.id.name;
        if (!getVariableFunctionNode(declarator)) {
          context.report({
            node: declarator.id,
            message: `exported value "${name}" not allowed; export functions or types only`,
          });
          continue;
        }
        checkFunctionName(declarator.id, name);
      }
    }
  }

  return {
    Program(node) {
      for (const statement of node.body) {
        rememberDeclaration(statement);
      }
    },
    ExportNamedDeclaration(node) {
      if (node.exportKind === "type") return;
      if (node.declaration) {
        checkDeclaration(node.declaration);
        return;
      }
      for (const specifier of node.specifiers) {
        if (specifier.exportKind === "type") continue;
        const localName = specifier.local?.name ?? "";
        const exportedName = specifier.exported?.name ?? localName;
        if (node.source) {
          if (!exportedName.startsWith(kind)) {
            context.report({ node: specifier, message: `exported function must start with ${kind}` });
          }
          continue;
        }
        const declarationKind = declarations.get(localName);
        if (declarationKind === "class") {
          context.report({ node: specifier, message: `exported classes not allowed in ${fileLabel}` });
        } else if (declarationKind === "value") {
          context.report({
            node: specifier,
            message: `exported value "${exportedName}" not allowed; export functions or types only`,
          });
        } else if (declarationKind === "function") {
          checkFunctionName(specifier, exportedName);
        }
      }
    },
    ExportDefaultDeclaration(node) {
      if (node.declaration?.type === "FunctionDeclaration") {
        checkFunctionName(node.declaration.id ?? node.declaration, node.declaration.id?.name ?? "");
        return;
      }
      context.report({ node, message: `export assignment not allowed in ${fileLabel}` });
    },
  };
}

function createFxTxParamsRule(context) {
  const kind = getKind(context);
  const declarations = new Map();

  function rememberFunction(name, node) {
    if (name?.startsWith(kind) && isFunctionNode(node)) {
      declarations.set(name, node);
    }
  }

  function checkFunction(node, nameNode, name) {
    if (!name.startsWith(kind)) return;
    const params = node.params ?? [];
    if (params.length > 2) {
      context.report({
        node: nameNode ?? node,
        message: `${name} must take portal first and optional args second`,
      });
      return;
    }

    if (kind !== "fn" && params.length === 0) {
      context.report({
        node: nameNode ?? node,
        message: `${name} must take portal first and optional args second`,
      });
      return;
    }

    if (kind === "fn" && params.length === 0) return;

    const portalParam = unwrapParam(params[0]);
    const portalName = getParamName(portalParam);
    const portalTypeName = getIdentifierTypeName(portalParam);
    if (portalName !== "portal" || !portalTypeName) {
      context.report({
        node: params[0],
        message: `${name} first parameter must be named portal and typed as TPortal*`,
      });
    } else if (!portalTypeName.startsWith("TPortal")) {
      context.report({
        node: params[0],
        message: `${name} portal type must start with TPortal`,
      });
    }

    if (params.length < 2) return;

    const argsParam = unwrapParam(params[1]);
    const argsName = getParamName(argsParam);
    const hasArgsType = !!argsParam?.typeAnnotation;
    if (argsName !== "args" || !hasArgsType) {
      context.report({
        node: params[1],
        message: `${name} second parameter must be named args and have a type`,
      });
    }
  }

  function checkDeclaration(node) {
    if (node?.type === "FunctionDeclaration") {
      checkFunction(node, node.id, node.id?.name ?? "");
      return;
    }
    if (node?.type !== "VariableDeclaration") return;
    for (const declarator of node.declarations) {
      if (declarator.id?.type !== "Identifier") continue;
      const fnNode = getVariableFunctionNode(declarator);
      if (fnNode) checkFunction(fnNode, declarator.id, declarator.id.name);
    }
  }

  return {
    Program(node) {
      for (const statement of node.body) {
        if (statement.type === "FunctionDeclaration" && statement.id?.name) {
          rememberFunction(statement.id.name, statement);
        }
        if (statement.type === "VariableDeclaration") {
          for (const declarator of statement.declarations) {
            if (declarator.id?.type === "Identifier") {
              rememberFunction(declarator.id.name, getVariableFunctionNode(declarator));
            }
          }
        }
      }
    },
    ExportNamedDeclaration(node) {
      if (node.exportKind === "type") return;
      if (node.declaration) {
        checkDeclaration(node.declaration);
        return;
      }
      if (node.source) return;
      for (const specifier of node.specifiers) {
        if (specifier.exportKind === "type") continue;
        const localName = specifier.local?.name ?? "";
        const exportedName = specifier.exported?.name ?? localName;
        const fnNode = declarations.get(localName);
        if (fnNode) checkFunction(fnNode, specifier, exportedName);
      }
    },
    ExportDefaultDeclaration(node) {
      if (node.declaration?.type === "FunctionDeclaration") {
        checkFunction(node.declaration, node.declaration.id, node.declaration.id?.name ?? "");
      }
    },
  };
}

export default {
  meta: {
    name: "eslint-plugin-functional-core",
  },
  rules: {
    "import-boundary": {
      meta: makeDocs("enforce functional-core runtime import boundaries"),
      create: createImportBoundaryRule,
    },
    "no-runtime-globals": {
      meta: makeDocs("disallow direct runtime global usage"),
      create: createNoRuntimeGlobalsRule,
    },
    "export-shape": {
      meta: makeDocs("enforce functional-core export shape"),
      create: createExportShapeRule,
    },
    "fx-tx-params": {
      meta: makeDocs("enforce fx/tx portal and args parameter shape"),
      create: createFxTxParamsRule,
    },
  },
};
