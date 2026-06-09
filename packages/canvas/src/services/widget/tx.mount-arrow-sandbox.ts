import { html as HTML } from '@arrow-js/core';
import { sandbox as SANDBOX } from '@arrow-js/sandbox';
// import SDK_SOURCE from '../../../../sdk/dist/index.js?raw';
import type { IWidgetConfig } from './interface';

type TPortal = {
  root: HTMLElement;
};

type TArgs = {
  sandbox: NonNullable<IWidgetConfig['sandbox']>;
};

const SDK_MODULE_PATH = '/__vibecanvas_sdk.js';
const SANDBOX_BASE_CSS = `
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

function getSandboxSource(source: Record<string, string | undefined>): Record<string, string> {
  const nextSource: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(source).flatMap(([path, fileSource]) => {
        if (fileSource === undefined) return [];
        return [[path, fileSource.replaceAll('@vibecanvas/sdk', SDK_MODULE_PATH)]];
      }),
    ),
    // TODO: [S54]
    // [SDK_MODULE_PATH]: SDK_SOURCE,
  };

  nextSource['main.css'] = `${SANDBOX_BASE_CSS}\n${nextSource['main.css'] ?? ''}`;

  return nextSource;
}

export function txMountArrowSandbox(portal: TPortal, args: TArgs) {
  HTML`<section class="vc-widget-sandbox-shell">
    <style>
      .vc-widget-sandbox-shell,
      .vc-widget-sandbox-shell > arrow-sandbox {
        display: block;
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
      }
    </style>
    ${SANDBOX({
      source: getSandboxSource(args.sandbox.arrowjs),
    })}
  </section>`(portal.root);
}
