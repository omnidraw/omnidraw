import type {
  CapsuleCapabilityBinding,
  CapsuleMountGuestChannels,
} from '@omnidraw/capsule-omnidraw/host';
import {
  CapsuleMemoryArtifactCache,
  createDefaultCapsuleBrowserPlatform,
} from '@omnidraw/capsule-omnidraw/host';
import {
  createOmnidrawCapsuleAuthoringInspection,
  createOmnidrawCapsuleAuthoringInspectionHost,
} from '@omnidraw/capsule-omnidraw/authoring-inspection';
import { createWidgetCapsuleCapabilityBindings } from './create-widget-capsule-capability-bindings';
import {
  createWidgetCapsuleMountCatalog,
  verifyWidgetBrowserFunctionDescriptors,
} from './create-widget-capsule-mount-catalog';
import {
  fnAssertWidgetCapsuleRuntimeCompatible,
  fnResolveWidgetCapsuleCapabilities,
  fnValidateWidgetCapsuleHostCatalog,
  fnValidateWidgetCapsuleMountCatalog,
} from './fn.capsule-catalog';
import { fnWidgetCapsuleViewport } from './fn.capsule-viewport';
import type {
  TWidgetAuthoringInspectionMountPort,
  TWidgetAuthoringInspectionRuntimeHandle,
  TWidgetCapsuleMountCatalog,
} from './interface';

type TCreateWidgetAuthoringInspectionMountPortArgs = Readonly<{
  document: Document;
  createStreamId(): string;
  digestSha256(bytes: Uint8Array): Promise<string>;
}>;

function capabilityPolicy(catalog: TWidgetCapsuleMountCatalog) {
  return Object.freeze(catalog.capabilities.map(({ descriptor }) => Object.freeze({
    effect: 'allow' as const,
    id: descriptor.id,
    versionRange: descriptor.version,
    contractHash: descriptor.contractHash,
    operations: Object.freeze(
      descriptor.operations.map((operation) => operation.name).sort(),
    ),
  })));
}

function guestChannels(
  args: Parameters<TWidgetAuthoringInspectionMountPort['mount']>[0],
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
            initial: args.theme,
          }),
        }),
    ...(declaration.output === undefined
      ? {}
      : {
          output: Object.freeze({
            schema: declaration.output,
            onOutput(): void {
              // Inspection output is deliberately ephemeral and unobserved.
            },
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
  await Promise.allSettled(
    bindings.map((binding) => Promise.resolve(binding.dispose())),
  );
}

export function createWidgetAuthoringInspectionMountPort(
  config: TCreateWidgetAuthoringInspectionMountPortArgs,
): TWidgetAuthoringInspectionMountPort {
  return Object.freeze({
    async mount(args): Promise<TWidgetAuthoringInspectionRuntimeHandle> {
      fnValidateWidgetCapsuleHostCatalog(args.catalog);
      const functionDescriptors = await verifyWidgetBrowserFunctionDescriptors(
        config.digestSha256,
        args.browserFunctionDescriptorsDigestSha256,
        args.functionDescriptors,
      );
      const mountArgs = Object.freeze({
        mode: 'preview' as const,
        root: args.root,
        identity: args.identity,
        artifact: args.artifact,
        functionDescriptors,
        browserFunctionDescriptorsDigestSha256:
          args.browserFunctionDescriptorsDigestSha256,
        functionBridge: args.functionBridge,
        collaborativeStateBridge: null,
        ...(args.props === undefined ? {} : { props: args.props }),
        onFatal: args.onFatal,
      });
      const catalog = await createWidgetCapsuleMountCatalog(args.catalog, mountArgs);
      fnValidateWidgetCapsuleMountCatalog(catalog);
      fnAssertWidgetCapsuleRuntimeCompatible(
        catalog,
        args.artifact.runtimeDescriptor,
        'preview',
      );
      const resolved = fnResolveWidgetCapsuleCapabilities(
        catalog,
        args.artifact.runtimeDescriptor.capabilityRequests,
      );
      const signingKey = catalog.trustedSigningKeys.get(catalog.previewSigningKeyId);
      if (signingKey === undefined) {
        throw new Error('Preview inspection signing authority is unavailable.');
      }
      let bindings: readonly CapsuleCapabilityBinding[] = [];
      let host: Awaited<ReturnType<typeof createOmnidrawCapsuleAuthoringInspectionHost>>
        | undefined;
      let rawHandle: Awaited<ReturnType<NonNullable<typeof host>['mount']>>
        | undefined;
      let releaseRuntimeEvents = (): void => undefined;
      const inspection = createOmnidrawCapsuleAuthoringInspection({
        maxResults: 128,
        maxSummaryResults: 128,
        maxCanvases: 16,
      });
      const observeRuntimeEvent = (event: Parameters<typeof args.onRuntimeEvent>[0]): void => {
        try {
          args.onRuntimeEvent(event);
        } catch {
          // An inspection observer cannot affect the mounted Capsule runtime.
        }
      };
      try {
        bindings = createWidgetCapsuleCapabilityBindings({
          catalog,
          requests: args.artifact.runtimeDescriptor.capabilityRequests,
          functionDescriptors,
          functionBridge: args.functionBridge,
          collaborativeStateBridge: null,
          createStreamId: config.createStreamId,
        });
        host = await createOmnidrawCapsuleAuthoringInspectionHost({
          allowedApis: args.artifact.runtimeDescriptor.apiContract.groups,
          limits: catalog.limits,
          capabilities: capabilityPolicy(catalog),
          artifactVerification: {
            signaturePolicy: {
              trustedKeys: new Map([[catalog.previewSigningKeyId, signingKey]]),
              minimumValidSignatures: 1,
              requiredKeyIds: [catalog.previewSigningKeyId],
              rejectUntrustedSignatures: true,
            },
          },
          vm: {
            mode: 'release',
            maxJobsPerDrain: 1_000,
            maxEntryDepth: 32,
          },
          browserPlatform: createDefaultCapsuleBrowserPlatform({
            document: config.document,
          }),
          artifactCache: new CapsuleMemoryArtifactCache({
            maxEntries: 1,
            maxTotalBytes: 16 * 1_024 * 1_024,
            maxArtifactBytes: 16 * 1_024 * 1_024,
          }),
          schemas: catalog.schemas,
        });
        for (const { descriptor } of catalog.capabilities) {
          host.registerCapabilityDescriptor(descriptor);
        }
        rawHandle = await host.mount({
          artifact: Uint8Array.from(args.artifact.bytes),
          container: args.root,
          capabilityBindings: bindings,
          grants: Object.freeze(resolved.map(({ grant }) => grant)),
          guestChannels: guestChannels(args),
          visualConfinement: 'strict',
          authoringInspection: inspection.attachment,
          onError: observeRuntimeEvent,
        });
        const runtimeEventSubscription = rawHandle.onError(observeRuntimeEvent);
        let runtimeEventsActive = true;
        releaseRuntimeEvents = (): void => {
          if (!runtimeEventsActive) return;
          runtimeEventsActive = false;
          try {
            runtimeEventSubscription.unsubscribe();
          } catch {
            // Subscription cleanup cannot block terminal mount cleanup.
          }
        };
        const diagnostics = rawHandle.diagnostics();
        if (diagnostics.artifactHash !== args.artifact.capsuleArtifactHash) {
          throw new Error('Inspected Capsule artifact hash does not match runtime metadata.');
        }
        rawHandle.setViewport(fnWidgetCapsuleViewport({
          width: args.root.clientWidth,
          height: args.root.clientHeight,
          scale: args.root.ownerDocument.defaultView?.devicePixelRatio ?? 1,
          visibility: 'visible',
          distance: 0,
          priority: 0,
          occlusion: 0,
        }));
        let destroyOperation: Promise<void> | undefined;
        const mountedHandle = rawHandle;
        const mountedHost = host;
        return Object.freeze({
          inspection,
          ready: () => mountedHandle.ready(),
          diagnostics: () => mountedHandle.diagnostics(),
          destroy(reason?: string): Promise<void> {
            if (destroyOperation !== undefined) return destroyOperation;
            destroyOperation = (async () => {
              releaseRuntimeEvents();
              await mountedHandle.destroy(reason).catch(() => undefined);
              inspection.dispose();
              await disposeBindings(bindings);
              await Promise.resolve()
                .then(() => args.functionBridge.dispose())
                .catch(() => undefined);
              await mountedHost.destroy();
            })();
            return destroyOperation;
          },
        });
      } catch (error) {
        releaseRuntimeEvents();
        await rawHandle?.destroy('authoring-inspection-mount-failed')
          .catch(() => undefined);
        inspection.dispose();
        await disposeBindings(bindings);
        await host?.destroy().catch(() => undefined);
        await Promise.resolve()
          .then(() => args.functionBridge.dispose())
          .catch(() => undefined);
        throw error;
      }
    },
  });
}
