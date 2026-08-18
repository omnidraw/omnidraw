import type {
  IWidgetBrowserHost,
  IWidgetBrowserMount,
  IWidgetFunctionHostPort,
  IWidgetOutputHostPort,
  TWidgetBrowserArtifact,
  TWidgetServerFunctionDescriptor,
  TWidgetHostDiagnostic,
  TWidgetHostSubject,
  TWidgetProps,
  TWidgetTheme,
  TWidgetFunctionInvocation,
  TWidgetSerializableJsonValue,
  TWidgetViewport,
} from "@omnidraw/sdk";
import { createWidgetBrowserHost } from "@omnidraw/sdk/host";
import type { FrontendRpcConnection } from "@/shell/transport/rpc";
import type {
  TWidgetPreviewBuildState,
  TWidgetTransportArtifact,
} from "@/core/app/private-operation-contract";
import { mountWidgetTarget } from "./mount-target";

type TTransportArtifact = TWidgetTransportArtifact;

export type TFrontendWidgetMountRequest = Readonly<{
  mode: "preview" | "published";
  container: HTMLElement;
  subject: TWidgetHostSubject;
  viewport: TWidgetViewport;
  theme: TWidgetTheme;
  props?: TWidgetSerializableJsonValue;
  signal?: AbortSignal;
  onDiagnostic?(diagnostic: TWidgetHostDiagnostic): void;
  onFatal?(error: unknown): void;
}>;

function decodeBase64(value: string, decode: (value: string) => string): Uint8Array {
  return Uint8Array.from(decode(value), (character) => character.charCodeAt(0));
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

async function browserArtifact(
  host: IWidgetBrowserHost,
  response: TTransportArtifact,
  decode: (value: string) => string,
): Promise<TWidgetBrowserArtifact> {
  const runtime = response.runtime ?? response.runtimeDescriptor;
  if (runtime === undefined) throw new Error("Widget runtime metadata is unavailable.");
  return host.validateArtifact({
    ...response,
    ...record(runtime),
    bytes: decodeBase64(response.artifact.bytesBase64, decode),
    digestSha256: response.artifact.digestSha256,
    runtime,
    functions: response.functionDescriptors ?? [],
  });
}

function functionPort(
  rpc: FrontendRpcConnection,
  mode: "preview" | "published",
  subject: TWidgetHostSubject,
  catalogGeneration: number | undefined,
): IWidgetFunctionHostPort {
  return {
    async invoke<TOutput extends TWidgetSerializableJsonValue>(request: TWidgetFunctionInvocation): Promise<TOutput> {
      const path = mode === "preview" ? "widget.preview.invoke" : "function.invoke";
      if (mode === "published" && catalogGeneration === undefined) {
        throw new Error("Published widget catalog generation is unavailable.");
      }
      const result = mode === "preview"
        ? await rpc.request("widget.preview.invoke", {
            canvasId: subject.canvasId,
            elementId: subject.elementId,
            functionName: request.functionName,
            input: request.input,
          }, { signal: request.signal })
        : await rpc.request("function.invoke", {
            ...subject,
            catalogGeneration: catalogGeneration!,
            functionName: request.functionName,
            input: request.input,
          }, { signal: request.signal });
      if (result.status !== "succeeded") {
        throw new Error(result.failure.message ?? `Widget function ${result.status}.`);
      }
      if (result.output === null) throw new Error("Widget function returned no output.");
      return result.output as TOutput;
    },
  };
}

export class FrontendWidgetRuntime {
  readonly #output: IWidgetOutputHostPort;
  readonly #rpc: FrontendRpcConnection;
  readonly #decodeBase64: (value: string) => string;
  readonly #hostPromise: Promise<IWidgetBrowserHost>;

  constructor(options: Readonly<{
    document: Document;
    rpc: FrontendRpcConnection;
    createId(): string;
    decodeBase64(value: string): string;
    digestSha256(bytes: Uint8Array): Promise<string>;
    output: IWidgetOutputHostPort;
  }>) {
    this.#output = options.output;
    this.#rpc = options.rpc;
    this.#decodeBase64 = options.decodeBase64;
    this.#hostPromise = createWidgetBrowserHost({
      document: options.document,
      createId: options.createId,
      catalog: () => options.rpc.request("widget.runtime.config"),
      digestSha256: options.digestSha256,
    });
  }

  async mount(request: TFrontendWidgetMountRequest): Promise<IWidgetBrowserMount> {
    const response = request.mode === "preview"
      ? await this.#rpc.request("widget.preview.open", {
          canvasId: request.subject.canvasId,
          elementId: request.subject.elementId,
          widgetKey: request.subject.widgetKey,
        }, { signal: request.signal })
      : await this.#rpc.request("widget.runtime.load", request.subject, { signal: request.signal });
    const host = await this.#hostPromise;
    const artifact = await browserArtifact(host, response, this.#decodeBase64);
    return mountWidgetTarget({
      container: request.container,
      signal: request.signal,
      mount: (target) => host.mount({
        mode: request.mode,
        artifact,
        container: target,
        subject: request.subject,
        viewport: request.viewport,
        theme: request.theme,
        props: (typeof request.props === "object" && request.props !== null && !Array.isArray(request.props)
          ? request.props
          : {}) as TWidgetProps,
        functions: functionPort(
          this.#rpc,
          request.mode,
          request.subject,
          response.identity?.catalogGeneration,
        ),
        output: this.#output,
        signal: request.signal,
        onDiagnostic: request.onDiagnostic,
        onFatal: request.onFatal,
      }),
    });
  }

  async buildState(
    widgetKey: string,
    signal?: AbortSignal,
  ): Promise<TWidgetPreviewBuildState> {
    return this.#rpc.request("widget.preview.buildState", { widgetKey }, { signal });
  }

  async dispose(): Promise<void> {
    const host = await this.#hostPromise;
    await host.dispose();
  }
}
