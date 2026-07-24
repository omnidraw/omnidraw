import { CanvasProductGeometryService } from "./CanvasProductGeometryService";
import { CanvasProductInteractionService } from "./CanvasProductInteractionService";
import { CanvasProductTransformService } from "./CanvasProductTransformService";
import { CanvasProductTransientService } from "./CanvasProductTransientService";
import type { TCanvasProductRuntimeEnginePorts } from "./interface";

export class CanvasProductRuntime {
  readonly geometry: CanvasProductGeometryService;
  readonly interactions: CanvasProductInteractionService;
  readonly transforms: CanvasProductTransformService;
  readonly transients: CanvasProductTransientService;
  readonly #ports: TCanvasProductRuntimeEnginePorts;
  #destroyed = false;

  constructor(ports: TCanvasProductRuntimeEnginePorts) {
    this.#ports = ports;
    this.geometry = new CanvasProductGeometryService(ports);
    this.interactions = new CanvasProductInteractionService(ports);
    this.transforms = new CanvasProductTransformService(ports);
    this.transients = new CanvasProductTransientService(ports);
  }

  cancelForRemoteChange(): void {
    this.#assertActive();
    let firstError: unknown;
    try {
      this.interactions.cancelForRemoteChange();
    } catch (error) {
      firstError = error;
    }
    try {
      this.transforms.cancelForRemoteChange();
    } catch (error) {
      firstError ??= error;
    }
    if (firstError !== undefined) {
      throw firstError;
    }
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    let firstError: unknown;
    for (const destroy of [
      () => this.interactions.destroy(),
      () => this.transforms.destroy(),
      () => this.transients.destroy(),
      () => this.geometry.destroy(),
    ]) {
      try {
        destroy();
      } catch (error) {
        firstError ??= error;
        try {
          this.#ports.onDiagnostic?.({
            operation: "teardown",
            error,
          });
        } catch {
          // Diagnostics cannot stop remaining facade cleanup.
        }
      }
    }
    if (firstError !== undefined) {
      throw firstError;
    }
  }

  #assertActive(): void {
    if (this.#destroyed) {
      throw new Error("CanvasProductRuntime has been destroyed.");
    }
  }
}
