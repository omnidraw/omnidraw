import {
  fnReadCanvasWidgetExtension,
  type TCanvasItemSnapshot,
} from '@omnidraw/canvas-contract';
import type {
  IFunctionInvocationApiCapability,
  TFunctionInputs,
  TDirectFunctionView,
} from '#backend/shell/api/function';
import type { IDirectFunctionInvoker } from '#backend/shell/function-execution';
import {
  DirectInvocationResourceGateway,
  type EphemeralResourceWritePermitAuthority,
} from '#backend/shell/function-execution/local';
import type { ICanvasService } from '#backend/shell/canvas/authority';
import type { TResourceRequirement } from '#backend/shell/resources';
import type { WidgetFilesystemRuntimeCatalog } from '../widget/WidgetFilesystemRuntimeCatalog';
import type { ResourceService } from '../resources/ResourceService';
import {
  FunctionProgramError,
  type TFunctionProgramErrorCode,
} from '../../core/functions/service.functions';

type TFunctionServiceConfig = Readonly<{
  canvas: ICanvasService;
  catalog: WidgetFilesystemRuntimeCatalog;
  resources: ResourceService;
  executor: IDirectFunctionInvoker;
  writePermits: EphemeralResourceWritePermitAuthority;
  nowMs: () => number;
}>;

function functionServiceError(code: TFunctionProgramErrorCode, message: string): FunctionProgramError {
  return new FunctionProgramError(code, message);
}

function widgetExtension(
  item: TCanvasItemSnapshot | undefined,
  input: TFunctionInputs['invoke'],
): Readonly<{
  schemaVersion: 1;
  type: 'widget-instance' | 'widget-preview';
  instanceId: string;
  widgetKey: string;
  uiProps?: unknown;
}> {
  const extension = item === undefined ? null : fnReadCanvasWidgetExtension(item.item);
  if (
    item?.id !== input.elementId
    || extension?.type !== 'widget-instance'
    || extension.instanceId !== input.widgetInstanceId
    || extension.widgetKey !== input.widgetKey
  ) throw functionServiceError('WIDGET_INSTANCE_NOT_FOUND', 'Widget instance was not found.');
  return extension;
}

function effectAllows(
  effect: TResourceRequirement['effect'],
  requested: 'read' | 'write',
): boolean {
  return effect === requested || effect === 'read_write';
}

/** Filesystem-catalog direct execution. Completed calls are never retained. */
class FunctionService implements IFunctionInvocationApiCapability {
  readonly name = 'function-service';
  readonly #config: TFunctionServiceConfig;

  constructor(config: TFunctionServiceConfig) {
    this.#config = config;
  }

  async invokeFunction(
    input: TFunctionInputs['invoke'],
    signal?: AbortSignal,
  ): Promise<TDirectFunctionView> {
    const readItem = async (): Promise<TCanvasItemSnapshot> => {
      const page = await this.#config.canvas.queryItems({
        canvasId: input.canvasId,
        filter: { type: 'widget-instance', instanceId: input.widgetInstanceId },
        limit: 2,
      });
      const item = page.items.find((candidate) => candidate.id === input.elementId);
      widgetExtension(item, input);
      return item!;
    };

    const firstItem = await readItem();
    widgetExtension(firstItem, input);
    const resolution = await this.#config.catalog.resolveRuntime(input.widgetKey);
    if (
      resolution.widgetKey !== input.widgetKey
      || resolution.catalogGeneration !== input.catalogGeneration
      || resolution.release.server === null
      || resolution.serverEntryBytes === null
    ) throw functionServiceError('FUNCTION_NOT_FOUND', 'Published function was not found.');
    const descriptor = resolution.functionDescriptors.find(
      (candidate) => candidate.exportName === input.functionName,
    );
    if (descriptor === undefined) {
      throw functionServiceError('FUNCTION_NOT_FOUND', 'Published function was not found.');
    }
    const requirements = resolution.manifest.resources ?? [];
    const bindings = await this.#resolveBindings(requirements);
    await readItem();
    if (!this.#config.catalog.isRuntimeResolutionCurrent(resolution)) {
      throw functionServiceError('WIDGET_CATALOG_CHANGED', 'Function target changed before execution.');
    }
    const access = this.#config.resources.createFunctionResourceGateway({
      requirements,
      bindings,
    });
    const server = resolution.release.server;
    const serverEntryBytes = resolution.serverEntryBytes;
    if (server === null || serverEntryBytes === null) {
      throw functionServiceError('FUNCTION_NOT_FOUND', 'Published function was not found.');
    }
    const artifactFile = resolution.release.files.find(
      (file) => file.path === server.entry,
    );
    if (
      artifactFile === undefined
      || artifactFile.byteSize !== serverEntryBytes.byteLength
      || artifactFile.sha256 !== server.moduleDigestSha256
    ) {
      throw functionServiceError('FUNCTION_NOT_FOUND', 'Published function artifact was not found.');
    }

    return this.#config.executor.invoke({
      subject: {
        canvasId: input.canvasId,
        elementId: input.elementId,
        widgetInstanceId: input.widgetInstanceId,
      },
      definition: {
        widgetKey: input.widgetKey,
        catalogGeneration: resolution.catalogGeneration,
        serverModule: {
          format: server.format,
          abi: server.abi,
          moduleDigestSha256: server.moduleDigestSha256,
          functionDescriptors: resolution.functionDescriptors,
          functionDescriptorsDigestSha256: server.functionsDigestSha256,
        },
        descriptor,
      },
      artifact: serverEntryBytes,
      input: input.input,
      signal,
      createResources: (call) => new DirectInvocationResourceGateway({
        call,
        gateway: access.gateway,
        bindings: access.bindings,
        writePermits: this.#config.writePermits,
        nowMs: this.#config.nowMs,
      }),
    });
  }

  async #resolveBindings(
    requirements: readonly TResourceRequirement[],
  ): Promise<readonly Readonly<{
    slot: string;
    resourceId: string;
    kind: TResourceRequirement['kind'];
    allowRead: boolean;
    allowWrite: boolean;
  }>[]> {
    const result: Array<Readonly<{
      slot: string;
      resourceId: string;
      kind: TResourceRequirement['kind'];
      allowRead: boolean;
      allowWrite: boolean;
    }>> = [];
    for (const requirement of requirements) {
      if (requirement.resourceId === undefined) {
        if (!requirement.required) continue;
        throw functionServiceError(
          'WIDGET_RESOURCE_BINDING_REQUIRED',
          `Required function resource slot '${requirement.slot}' is unconfigured.`,
        );
      }
      const resource = await this.#config.resources.getResource(requirement.resourceId);
      if (resource === null) throw functionServiceError(
        'WIDGET_RESOURCE_BINDING_STALE',
        'Function resource is unavailable.',
      );
      if (resource.status !== 'ready') throw functionServiceError(
        'WIDGET_RESOURCE_NOT_READY',
        'Function resource is not ready.',
      );
      if (resource.kind !== requirement.kind) throw functionServiceError(
        'WIDGET_RESOURCE_KIND_MISMATCH',
        'Function resource has the wrong kind.',
      );
      result.push(Object.freeze({
        slot: requirement.slot,
        resourceId: requirement.resourceId,
        kind: resource.kind,
        allowRead: effectAllows(requirement.effect, 'read'),
        allowWrite: effectAllows(requirement.effect, 'write'),
      }));
    }
    return Object.freeze(result);
  }
}

export { FunctionService };
export type { TFunctionServiceConfig };
