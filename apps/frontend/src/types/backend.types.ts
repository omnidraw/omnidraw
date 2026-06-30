/**
 * Backend Types
 *
 * Types that mirror the database schema from imperative-shell.
 * These represent the source of truth from the server.
 */

import type { TCanvas } from "@vibecanvas/service-db/model";

// Canvas ID type used throughout the app
export type TCanvasId = string;

// Canvas table schema
export type TBackendCanvas = TCanvas;