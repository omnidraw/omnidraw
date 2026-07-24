import type {
  ICamera2DController,
  IGeometryService,
  IInteractionController,
  ISceneStore,
  ITextService,
  ITransformController,
} from "@omnidraw/cangine";
import type { CanvasTransientTargetRegistry } from "../input/CanvasTransientTargetRegistry";
import type { CanvasTransientService } from "../transients/CanvasTransientService";
import type {
  TCanvasProductRuntimeData,
  TCanvasProductRuntimeDiagnostic,
} from "./typed";

export type TCanvasProductRuntimeEnginePorts = TCanvasProductRuntimeData & {
  camera: ICamera2DController;
  geometry: IGeometryService;
  interactions: IInteractionController;
  scene: ISceneStore;
  text: ITextService;
  transforms: ITransformController;
  transients: CanvasTransientService;
  transientTargets: CanvasTransientTargetRegistry;
  onDiagnostic?(diagnostic: TCanvasProductRuntimeDiagnostic): void;
};
