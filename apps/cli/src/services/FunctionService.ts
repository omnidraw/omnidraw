import {
  fnReadCanvasWidgetExtension,
  type TCanvasItemSnapshot,
  type TCanvasWidgetResourceBindingV1,
} from '@omnidraw/canvas-contract';
import type {
  IFunctionInvocationApiCapability,
  TFunctionInputs,
  TDirectFunctionView,
} from '@omnidraw/api/function';
import type { IDirectFunctionInvoker } from '@omnidraw/function-runtime';
import {
  DirectInvocationResourceGateway,
  type EphemeralResourceWritePermitAuthority,
} from '@omnidraw/function-runtime/local';
import type { IService } from '@omnidraw/runtime';
import type { ICanvasService } from '@omnidraw/service-canvas';
import type { TResourceRequirement } from '@omnidraw/resource-runtime';
import type { WidgetFilesystemRuntimeCatalog } from './WidgetFilesystemRuntimeCatalog';
import type { ResourceService } from './ResourceService';

type TFunctionServiceConfig = Readonly<{
  canvas: ICanvasService;
  catalog: WidgetFilesystemRuntimeCatalog;
  resources: ResourceService;
  executor: IDirectFunctionInvoker;
  writePermits: EphemeralResourceWritePermitAuthority;
}>;

function functionServiceError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function widgetExtension(
  item: TCanvasItemSnapshot | undefined,
  input: TFunctionInputs['invoke'],
): Extract<
  NonNullable<ReturnType<typeof fnReadCanvasWidgetExtension>>,
  Readonly<{ type: 'widget-instance' }>
> {
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
class FunctionService implements IService, IFunctionInvocationApiCapability {
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
    const firstExtension = widgetExtension(firstItem, input);
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
    const secondItem = await readItem();
    const extension = widgetExtension(secondItem, input);
    if (
      JSON.stringify(extension.resourceBindings ?? {})
        !== JSON.stringify(firstExtension.resourceBindings ?? {})
      || !this.#config.catalog.isRuntimeResolutionCurrent(resolution)
    ) throw functionServiceError('WIDGET_CATALOG_CHANGED', 'Function target changed before execution.');

    const requirements = resolution.manifest.resources ?? [];
    const bindings = await this.#resolveBindings(
      requirements,
      extension.resourceBindings ?? {},
    );
    const access = this.#config.resources.createFunctionResourceGateway({
      requirements,
      bindings,
    });
    const artifactFile = resolution.release.files.find(
      (file) => file.path === resolution.release.server!.entry,
    );
    if (artifactFile === undefined || artifactFile.byteSize !== resolution.serverEntryBytes.byteLength) {
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
        runtimeAbi: resolution.release.server.runtimeAbi,
        artifactDigestSha256: artifactFile.sha256,
        descriptor,
      },
      artifact: resolution.serverEntryBytes,
      input: input.input,
      signal,
      createResources: (call) => new DirectInvocationResourceGateway({
        call,
        gateway: access.gateway,
        bindings: access.bindings,
        writePermits: this.#config.writePermits,
      }),
    });
  }

  async #resolveBindings(
    requirements: readonly TResourceRequirement[],
    selections: Readonly<Record<string, TCanvasWidgetResourceBindingV1>>,
  ): Promise<readonly Readonly<{
    slot: string;
    resourceId: string;
    kind: TResourceRequirement['kind'];
    allowRead: boolean;
    allowWrite: boolean;
  }>[]> {
    const bySlot = new Map(requirements.map((item) => [item.slot, item]));
    const result = await Promise.all(Object.keys(selections).sort().map(async (slot) => {
      const selection = selections[slot]!;
      const requirement = bySlot.get(slot);
      const resource = await this.#config.resources.getResource(selection.resourceId);
      if (
        requirement === undefined
        || resource === null
        || resource.status !== 'ready'
        || resource.kind !== requirement.kind
        || (selection.allowRead && !effectAllows(requirement.effect, 'read'))
        || (selection.allowWrite && !effectAllows(requirement.effect, 'write'))
        || (!selection.allowRead && !selection.allowWrite)
      ) throw functionServiceError('FUNCTION_RESOURCE_UNAVAILABLE', 'Function resource is unavailable.');
      return Object.freeze({
        slot,
        resourceId: selection.resourceId,
        kind: resource.kind,
        allowRead: selection.allowRead,
        allowWrite: selection.allowWrite,
      });
    }));
    for (const requirement of requirements) {
      if (requirement.required && !selections[requirement.slot]) {
        throw functionServiceError('FUNCTION_RESOURCE_UNAVAILABLE', 'Required function resource is unavailable.');
      }
    }
    return Object.freeze(result);
  }
}

export { FunctionService };
export type { TFunctionServiceConfig };
