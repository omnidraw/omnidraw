export type TCanvasEngineOwnershipStageState =
  | "staged"
  | "prepared"
  | "committed"
  | "rolled-back";

/**
 * Resource and portal changes are prepared before a retained-scene update,
 * then committed only after that update succeeds.
 */
export interface ICanvasEngineOwnershipStage {
  readonly label: string;
  readonly state: TCanvasEngineOwnershipStageState;
  prepare(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
