import { fnDecodeWidgetUiArtifactEnvelope } from '@vibecanvas/widget-contract/browser';

export const WIDGET_SERVER_FUNCTION_TRANSPORT_GLOBAL_KEY = '__VIBECANVAS_SERVER_FUNCTION_TRANSPORT_V1__';
export const WIDGET_SERVER_FUNCTION_HOST_MODULE = 'host-bridge:vibecanvas-server-functions';
export const WIDGET_COLLABORATIVE_STATE_TRANSPORT_GLOBAL_KEY = '__VIBECANVAS_COLLABORATIVE_STATE_TRANSPORT_V1__';
export const WIDGET_COLLABORATIVE_STATE_HOST_MODULE = 'host-bridge:vibecanvas-collaborative-state';

export const WIDGET_UI_MAX_ACTIVE_RENDERS = 32;
export const WIDGET_UI_MAX_QUEUED_RENDERS = 512;

export const WIDGET_SANDBOX_TRUSTED_HOST_LAYOUT_CSS = `/* vibecanvas-trusted-host-layout-v1 */
:host {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
}

:host > div {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
}

*, *::before, *::after {
  box-sizing: border-box;
}
`;

export const WIDGET_UI_ARTIFACT_ENVELOPE_DECODER = fnDecodeWidgetUiArtifactEnvelope;
