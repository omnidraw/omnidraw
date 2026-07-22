/// <reference path="./assets.d.ts" />

import arrowJsPrompt from './prompt.arrow-js.md' with { type: 'text' };
import productAndManifestPrompt from './prompt.product-and-manifest.md' with { type: 'text' };
import serverFunctionsPrompt from './prompt.server-functions.md' with { type: 'text' };
import stateAndResourcesPrompt from './prompt.state-and-resources.md' with { type: 'text' };
import styleGuidePrompt from './prompt.style-guide.md' with { type: 'text' };
import toolsPrompt from './prompt.tools.md' with { type: 'text' };
import widgetImplementationPrompt from './prompt.widget-implementation.md' with { type: 'text' };

const WIDGET_CHAT_SYSTEM_PROMPT_SECTIONS = [
  productAndManifestPrompt,
  toolsPrompt,
  stateAndResourcesPrompt,
  serverFunctionsPrompt,
  widgetImplementationPrompt,
  arrowJsPrompt,
  styleGuidePrompt,
];

export const WIDGET_CHAT_SYSTEM_PROMPT = `\n${WIDGET_CHAT_SYSTEM_PROMPT_SECTIONS.map((section) => section.trim()).join('\n\n')}\n`;
