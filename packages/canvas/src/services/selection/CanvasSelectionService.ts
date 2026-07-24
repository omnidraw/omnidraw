/**
 * Compatibility export while callers move to the production SelectionService
 * name. Both names refer to the same renderer-neutral implementation.
 */
export {
  SelectionService as CanvasSelectionService,
} from "./SelectionService";
export type {
  TCanvasSelectionSnapshot,
  TSelectionServiceHooks as TCanvasSelectionServiceHooks,
  TSelectionServicePortal as TCanvasSelectionServicePortal,
} from "./SelectionService";
