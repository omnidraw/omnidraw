import type {
  CapsuleCapabilityBinding,
  CapsuleMountGuestChannels,
} from '@omnidraw/capsule-omnidraw/host';
import type {
  CapsuleStructuredValue,
} from '@omnidraw/capsule-omnidraw/capabilities';
import {
  fnOmnidrawWidgetNotificationOutput,
} from '@omnidraw/capsule-omnidraw/capabilities';
import {
  type TWidgetCapsuleTheme,
} from '@omnidraw/widget-contract';
import { CapsuleWidgetHostCoordinator } from './CapsuleWidgetHostCoordinator';
import { createWidgetCapsuleCapabilityBindings } from './create-widget-capsule-capability-bindings';
import type {
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
import {
  createWidgetCapsuleMountCatalog,
  verifyWidgetBrowserFunctionDescriptors,
} from './create-widget-capsule-mount-catalog';

type TCreateWidgetUiArtifactMountPortArgs = Readonly<{
  coordinator: CapsuleWidgetHostCoordinator;
  createStreamId(): string;
  digestSha256(bytes: Uint8Array): Promise<string>;
  nowMs(): number;
  portalContentSize: TPortalContentCssSize;
  theme: TWidgetCapsuleThemeSource;
  output: TWidgetCapsuleOutputSink;
}>;

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
          functionDescriptors: await verifyWidgetBrowserFunctionDescriptors(
            config.digestSha256,
            args.browserFunctionDescriptorsDigestSha256,
            args.functionDescriptors,
          ),
        });
        catalog = await createWidgetCapsuleMountCatalog(
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
