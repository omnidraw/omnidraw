import tsParser from "@typescript-eslint/parser";
import functionalCore from "./scripts/eslint-functional-core-plugin.mjs";

const functionalCoreLanguageOptions = {
  parser: tsParser,
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
};

const functionalCoreRules = {
  "functional-core/import-boundary": "error",
  "functional-core/no-runtime-globals": "error",
  "functional-core/export-shape": "error",
};

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/*.test.ts",
      "**/*.spec.ts",
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  {
    files: ["**/src/**/fn.*.ts"],
    plugins: {
      "functional-core": functionalCore,
    },
    languageOptions: functionalCoreLanguageOptions,
    rules: {
      ...functionalCoreRules,
      "functional-core/import-boundary": ["error", { kind: "fn" }],
      "functional-core/export-shape": ["error", { kind: "fn" }],
    },
  },
  {
    files: ["**/src/**/fx.*.ts"],
    plugins: {
      "functional-core": functionalCore,
    },
    languageOptions: functionalCoreLanguageOptions,
    rules: {
      ...functionalCoreRules,
      "functional-core/import-boundary": ["error", { kind: "fx" }],
      "functional-core/export-shape": ["error", { kind: "fx" }],
      "functional-core/fx-tx-params": ["error", { kind: "fx" }],
    },
  },
  {
    files: ["**/src/**/tx.*.ts"],
    plugins: {
      "functional-core": functionalCore,
    },
    languageOptions: functionalCoreLanguageOptions,
    rules: {
      ...functionalCoreRules,
      "functional-core/import-boundary": ["error", { kind: "tx" }],
      "functional-core/export-shape": ["error", { kind: "tx" }],
      "functional-core/fx-tx-params": ["error", { kind: "tx" }],
    },
  },
];
