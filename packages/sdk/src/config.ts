import type { TJsonSchema } from "./schema";
import type { TVibecanvasOfficialMachineState } from "./machine";

/**
 * Metadata config shape for a Vibecanvas guest widget.
 *
 * Use this type in `vibecanvas.config.ts` with `satisfies`.
 *
 * @example
 * import type { TVibecanvasWidgetConfig } from "@vibecanvas/sdk";
 *
 * export default {
 *   schemaVersion: 1,
 *   id: "todo-app",
 *   label: "Todo App",
 *   permissions: [],
 *   defaultSize: { width: 400, height: 600 },
 *   source: {
 *     "main.ts": "./src/main.ts",
 *     "main.css": "./src/main.css",
 *   },
 *   actor: {
 *     states: ["booting", "idle", "saving", "failed"],
 *     inputs: {
 *       addTodo: {
 *         label: "Add Todo",
 *         schema: {
 *           type: "object",
 *           properties: { title: { type: "string" } },
 *           required: ["title"],
 *           additionalProperties: false,
 *         },
 *       },
 *     },
 *     outputs: {
 *       todoCreated: {
 *         label: "Todo Created",
 *         schema: { type: "object" },
 *       },
 *     },
 *   },
 * } satisfies TVibecanvasWidgetConfig;
 */
type TVibecanvasWidgetConfig = {
  /** Version of the Vibecanvas widget config format. Use `1` for now. */
  schemaVersion: 1;
  /** Stable widget kind id. Prefer lowercase kebab-case, e.g. `todo-app`. */
  id: string;
  /** Human-readable widget name shown in menus and connection UI. */
  label: string;
  /** Requested host permissions. Keep empty unless Vibecanvas documents one. */
  permissions: string[];
  /** Default widget size when created from the toolbar. */
  defaultSize?: {
    /** Default width in canvas pixels. */
    width: number;
    /** Default height in canvas pixels. */
    height: number;
  };
  /** Source file map or config-relative source paths. Must include one `main.ts` or `main.js`. */
  source: Record<string, string>;
  /** Optional actor metadata used by Vibecanvas to connect widgets together. */
  actor?: {
    /** Optional list of widget-specific states this actor may enter. */
    states?: string[];
    /** Optional host-known official states this actor is expected to use. */
    officialStates?: TVibecanvasOfficialMachineState[];
    /** Input ports this widget can receive messages on. */
    inputs?: Record<string, { label?: string; schema?: TJsonSchema }>;
    /** Output ports this widget can emit messages from. */
    outputs?: Record<string, { label?: string; schema?: TJsonSchema }>;
  };
};

export type { TVibecanvasWidgetConfig };
