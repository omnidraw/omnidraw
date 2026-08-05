import type {
  CapsuleCapabilityBinding,
  CapsuleMountGuestChannels,
} from '@omnidraw/capsule-omnidraw/host';
import type {
  CapsuleStructuredValue,
  TOmnidrawCapsuleCapabilityContract,
} from '@omnidraw/capsule-omnidraw/capabilities';
import {
  createOmnidrawCollaborativeStateCapabilityContract,
  createOmnidrawGuestChannelContract,
  createOmnidrawServerFunctionCapabilityContract,
  fnOmnidrawWidgetNotificationOutput,
  OMNIDRAW_COLLABORATIVE_STATE_CAPABILITY_ID,
} from '@omnidraw/capsule-omnidraw/capabilities';
import {
  ZWidgetBrowserFunctionDescriptors,
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  fnWidgetBrowserFunctionCapabilityRequestMatches,
  type TWidgetBrowserFunctionDescriptor,
  type TWidgetCapsuleCapabilityRequest,
  type TWidgetCapsuleTheme,
} from '@omnidraw/widget-contract';
import { CapsuleWidgetHostCoordinator } from './CapsuleWidgetHostCoordinator';
import { createWidgetCapsuleCapabilityBindings } from './create-widget-capsule-capability-bindings';
import type {
  TWidgetCapsuleHostCatalog,
  TWidgetCapsuleMountCatalog,
  TWidgetCapsuleOutputSink,
  TWidgetCapsuleThemeSource,
  TWidgetUiArtifactMountPort,
  TWidgetUiRuntimeHandle,
} from './interface';
import {
  WIDGET_UI_OUTPUT_RATE_MAX_EVENTS,
  WIDGET_UI_OUTPUT_RATE_WINDOW_MS,
} from './CONSTANTS';
import { fnWidgetCapsuleViewport } from './fn.capsule-viewport';
import {
  fxPortalContentCssSize,
  type TPortal as TPortalContentCssSize,
} from './fx.portal-content-css-size';

type TCreateWidgetUiArtifactMountPortArgs = Readonly<{
  coordinator: CapsuleWidgetHostCoordinator;
  createStreamId(): string;
  digestSha256(bytes: Uint8Array): Promise<string>;
  nowMs(): number;
  portalContentSize: TPortalContentCssSize;
  theme: TWidgetCapsuleThemeSource;
  output: TWidgetCapsuleOutputSink;
}>;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(',')}}`;
}

function requestsMatch(
  derived: TOmnidrawCapsuleCapabilityContract['request'],
  signed: TWidgetCapsuleCapabilityRequest,
): boolean {
  return canonicalJson({
    ...derived,
    operations: [...derived.operations].sort(),
  }) === canonicalJson({
    ...signed,
    operations: [...signed.operations].sort(),
  });
}

function assertDerivedRequest(
  contract: TOmnidrawCapsuleCapabilityContract,
  request: TWidgetCapsuleCapabilityRequest,
): void {
  if (!requestsMatch(contract.request, request)) {
    throw new Error(
      `Widget Capsule capability "${request.id}" is inconsistent with its derived contract.`,
    );
  }
}

function functionDescriptorDigest(
  request: TWidgetCapsuleCapabilityRequest,
): string {
  const match = /^sha256:([0-9a-f]{64})$/.exec(request.contractHash);
  if (match === null) {
    throw new Error('Widget server-function contract hash is invalid.');
  }
  return match[1]!;
}

async function verifyBrowserFunctionDescriptors(
  digestSha256: (bytes: Uint8Array) => Promise<string>,
  expectedDigestSha256: string,
  descriptors: readonly TWidgetBrowserFunctionDescriptor[],
): Promise<readonly TWidgetBrowserFunctionDescriptor[]> {
  if (!SHA256_PATTERN.test(expectedDigestSha256)) {
    throw new Error('Widget browser function descriptor digest is invalid.');
  }
  const normalized = ZWidgetBrowserFunctionDescriptors.parse(descriptors);
  const actualDigestSha256 = await digestSha256(new TextEncoder().encode(
    fnCanonicalizeWidgetBrowserFunctionDescriptors(normalized),
  ));
  if (
    !SHA256_PATTERN.test(actualDigestSha256)
    || actualDigestSha256 !== expectedDigestSha256
  ) {
    throw new Error('Widget browser function descriptors failed integrity verification.');
  }
  return normalized;
}

function deduplicateSchemas(
  contracts: readonly Readonly<{
    schemas: TOmnidrawCapsuleCapabilityContract['schemas'];
  }>[],
) {
  const schemas = new Map<string, TOmnidrawCapsuleCapabilityContract['schemas'][number]>();
  for (const contract of contracts) {
    for (const schema of contract.schemas) {
      schemas.set(schema.reference.hash, schema);
    }
  }
  return Object.freeze([...schemas.values()].sort((left, right) => (
    left.reference.hash < right.reference.hash ? -1 : 1
  )));
}

async function createMountCatalog(
  base: TWidgetCapsuleHostCatalog,
  args: Parameters<TWidgetUiArtifactMountPort['mount']>[0],
): Promise<TWidgetCapsuleMountCatalog> {
  const requests = args.artifact.runtimeDescriptor.capabilityRequests;
  const collaborativeRequest = requests.find(
    (request) => request.id === OMNIDRAW_COLLABORATIVE_STATE_CAPABILITY_ID,
  );
  const functionRequests = requests.filter(
    (request) => request.id !== OMNIDRAW_COLLABORATIVE_STATE_CAPABILITY_ID,
  );
  if (
    functionRequests.length !== (args.functionDescriptors.length === 0 ? 0 : 1)
  ) {
    throw new Error('Widget server-function metadata does not match signed capability requests.');
  }

  const signedFunctionRequest = functionRequests.length === 0
    ? null
    : functionRequests[0]!;
  if (
    signedFunctionRequest !== null
    && !fnWidgetBrowserFunctionCapabilityRequestMatches(
      signedFunctionRequest,
      args.functionDescriptors,
    )
  ) {
    throw new Error(
      'Widget browser function descriptors do not match the signed capability request.',
    );
  }
  // contractHash binds the canonical server descriptor file (modulePath
  // included); that digest is unverifiable in the browser by design, so its
  // binding stays a host-side check. The client only re-derives the contract
  // under the signed selector.
  const functionContract = signedFunctionRequest === null
    ? null
    : await createOmnidrawServerFunctionCapabilityContract({
        descriptorDigestSha256: functionDescriptorDigest(signedFunctionRequest),
        functions: args.functionDescriptors,
      });
  if (functionContract !== null) {
    assertDerivedRequest(functionContract, functionRequests[0]!);
  }

  const collaborativeContract = collaborativeRequest === undefined
    ? null
    : await createOmnidrawCollaborativeStateCapabilityContract();
  if (collaborativeContract !== null) {
    assertDerivedRequest(collaborativeContract, collaborativeRequest!);
  }

  const channels = args.artifact.runtimeDescriptor.channels === null
    ? null
    : await createOmnidrawGuestChannelContract({
        localStore: args.artifact.runtimeDescriptor.channels.store === undefined
          ? 'none'
          : 'ephemeral',
      });
  if (
    channels !== null
    && canonicalJson(channels.declaration)
      !== canonicalJson(args.artifact.runtimeDescriptor.channels)
  ) {
    throw new Error('Widget Capsule channels are inconsistent with the host contract.');
  }

  const capabilityContracts = [functionContract, collaborativeContract].filter(
    (contract): contract is TOmnidrawCapsuleCapabilityContract => contract !== null,
  );
  return Object.freeze({
    ...base,
    schemas: deduplicateSchemas([
      ...capabilityContracts,
      ...(channels === null ? [] : [channels]),
    ]),
    capabilities: Object.freeze(capabilityContracts.map((contract) => Object.freeze({
      kind: contract === functionContract
        ? 'server-functions' as const
        : 'collaborative-state' as const,
      descriptor: contract.descriptor,
    }))),
  });
}

function guestChannels(
  args: Parameters<TWidgetUiArtifactMountPort['mount']>[0],
  theme: TWidgetCapsuleTheme,
  onOutput: (value: CapsuleStructuredValue) => void,
): CapsuleMountGuestChannels | undefined {
  const declaration = args.artifact.runtimeDescriptor.channels;
  if (declaration === null) return undefined;
  return Object.freeze({
    ...(declaration.props === undefined
      ? {}
      : {
          props: Object.freeze({
            schema: declaration.props,
            initial: args.props ?? Object.freeze({}),
          }),
        }),
    ...(declaration.theme === undefined
      ? {}
      : {
          theme: Object.freeze({
            schema: declaration.theme,
            initial: theme,
          }),
        }),
    ...(declaration.output === undefined
      ? {}
      : {
          output: Object.freeze({
            schema: declaration.output,
            onOutput,
          }),
        }),
    ...(declaration.store === undefined
      ? {}
      : {
          store: Object.freeze({
            schema: declaration.store.schema,
            maxEntries: declaration.store.maxEntries,
            initial: Object.freeze([]),
          }),
        }),
  });
}

async function disposeBindings(
  bindings: readonly CapsuleCapabilityBinding[],
): Promise<void> {
  await Promise.allSettled(bindings.map((binding) => Promise.resolve(binding.dispose())));
}

function ownedHandle(
  handle: TWidgetUiRuntimeHandle,
  args: Parameters<TWidgetUiArtifactMountPort['mount']>[0],
  releaseChannels: () => void,
): TWidgetUiRuntimeHandle {
  let destroyOperation: Promise<void> | undefined;
  return Object.freeze({
    ready: () => handle.ready(),
    setProps: (value: unknown) => handle.setProps(value),
    setTheme: (value: unknown) => handle.setTheme(value),
    setViewport: (value) => handle.setViewport(value),
    focus: (options?: FocusOptions) => handle.focus(options),
    setSchedulingMode: (mode) => handle.setSchedulingMode(mode),
    freeze: (reason?: string) => handle.freeze(reason),
    resume: (reason?: string) => handle.resume(reason),
    diagnostics: () => handle.diagnostics(),
    destroy(reason?: string): Promise<void> {
      if (destroyOperation !== undefined) return destroyOperation;
      releaseChannels();
      destroyOperation = handle.destroy(reason).finally(() => {
        args.functionBridge.dispose();
        args.collaborativeStateBridge?.dispose();
      });
      return destroyOperation;
    },
  });
}

export function createWidgetUiArtifactMountPort(
  config: TCreateWidgetUiArtifactMountPortArgs,
): TWidgetUiArtifactMountPort {
  return Object.freeze({
    async mount(args): Promise<TWidgetUiRuntimeHandle> {
      let mountArgs: Parameters<TWidgetUiArtifactMountPort['mount']>[0];
      let catalog: TWidgetCapsuleMountCatalog;
      try {
        mountArgs = Object.freeze({
          ...args,
          functionDescriptors: await verifyBrowserFunctionDescriptors(
            config.digestSha256,
            args.browserFunctionDescriptorsDigestSha256,
            args.functionDescriptors,
          ),
        });
        catalog = await createMountCatalog(
          await config.coordinator.catalog(),
          mountArgs,
        );
      } catch (error) {
        args.functionBridge.dispose();
        args.collaborativeStateBridge?.dispose();
        throw error;
      }
      let bindings: readonly CapsuleCapabilityBinding[] = [];
      let mounted: TWidgetUiRuntimeHandle | undefined;
      let channelsActive = true;
      let releaseTheme = (): void => undefined;
      let latestTheme: TWidgetCapsuleTheme | undefined;
      let themeRevision = 0;
      let outputWindowStartedAt = config.nowMs();
      let outputCount = 0;
      const releaseChannels = (): void => {
        if (!channelsActive) return;
        channelsActive = false;
        releaseTheme();
      };
      const routeOutput = (value: CapsuleStructuredValue): void => {
        if (!channelsActive) return;
        const output = fnOmnidrawWidgetNotificationOutput(value);
        const now = config.nowMs();
        if (!Number.isFinite(now)) return;
        if (
          now < outputWindowStartedAt
          || now - outputWindowStartedAt >= WIDGET_UI_OUTPUT_RATE_WINDOW_MS
        ) {
          outputWindowStartedAt = now;
          outputCount = 0;
        }
        if (outputCount >= WIDGET_UI_OUTPUT_RATE_MAX_EVENTS) return;
        outputCount += 1;
        config.output.notification(output);
      };
      try {
        releaseTheme = config.theme.subscribe((theme) => {
          if (!channelsActive) return;
          latestTheme = theme;
          themeRevision += 1;
          if (mounted === undefined) return;
          try {
            mounted.setTheme(theme);
          } catch (error) {
            releaseChannels();
            args.onFatal(error);
            void mounted.destroy('theme-channel-failed');
          }
        });
        latestTheme ??= config.theme.read();
        const initialThemeRevision = themeRevision;
        bindings = createWidgetCapsuleCapabilityBindings({
          catalog,
          requests: mountArgs.artifact.runtimeDescriptor.capabilityRequests,
          functionDescriptors: mountArgs.functionDescriptors,
          functionBridge: mountArgs.functionBridge,
          collaborativeStateBridge: mountArgs.collaborativeStateBridge,
          createStreamId: config.createStreamId,
        });
        mounted = await config.coordinator.mount({
          mode: mountArgs.mode,
          identity: mountArgs.identity,
          catalog,
          artifact: mountArgs.artifact,
          ...(mountArgs.sourceMapArtifact === undefined
            ? {}
            : { sourceMapArtifact: mountArgs.sourceMapArtifact }),
          container: mountArgs.root,
          capabilityBindings: bindings,
          guestChannels: guestChannels(mountArgs, latestTheme, routeOutput),
          ...(mountArgs.onDiagnostic === undefined
            ? {}
            : { onDiagnostic: mountArgs.onDiagnostic }),
          onFatal: mountArgs.onFatal,
        });
        if (themeRevision !== initialThemeRevision) {
          mounted.setTheme(latestTheme);
        }
        const size = fxPortalContentCssSize(config.portalContentSize, {
          host: mountArgs.root,
        });
        mounted.setViewport(fnWidgetCapsuleViewport({
          width: size.width,
          height: size.height,
          scale: mountArgs.root.ownerDocument.defaultView?.devicePixelRatio ?? 1,
          visibility: 'visible',
          distance: 0,
          priority: 0,
          occlusion: 0,
        }));
        return ownedHandle(mounted, mountArgs, releaseChannels);
      } catch (error) {
        releaseChannels();
        await mounted?.destroy('mount-initialization-failed').catch(() => undefined);
        await disposeBindings(bindings);
        args.functionBridge.dispose();
        args.collaborativeStateBridge?.dispose();
        throw error;
      }
    },
    destroy: (reason?: string) => config.coordinator.destroy(reason),
  });
}
