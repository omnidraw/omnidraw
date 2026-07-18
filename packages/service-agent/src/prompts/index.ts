/// <reference path="./assets.d.ts" />

import { RECOMMENDED_LUCIDE_STATIC_ICON_KEYS } from '@vibecanvas/service-actor/core/tool-icon';
import actorImplementationPrompt from './prompt.actor-implementation.md' with { type: 'text' };
import actorLifecycleAndActivityPrompt from './prompt.actor-lifecycle-and-activity.md' with { type: 'text' };
import arrowJsPrompt from './prompt.arrow-js.md' with { type: 'text' };
import productAndManifestPrompt from './prompt.product-and-manifest.md' with { type: 'text' };
import styleGuidePrompt from './prompt.style-guide.md' with { type: 'text' };
import toolsPrompt from './prompt.tools.md' with { type: 'text' };
import widgetImplementationPrompt from './prompt.widget-implementation.md' with { type: 'text' };

const WIDGET_CHAT_SYSTEM_PROMPT_SECTIONS = [
  productAndManifestPrompt.replace('{{LUCIDE_STATIC_ICON_KEYS}}', RECOMMENDED_LUCIDE_STATIC_ICON_KEYS.join(', ')),
  actorLifecycleAndActivityPrompt,
  toolsPrompt,
  actorImplementationPrompt,
  widgetImplementationPrompt,
  arrowJsPrompt,
  styleGuidePrompt,
];

export const WIDGET_CHAT_SYSTEM_PROMPT = `\n${WIDGET_CHAT_SYSTEM_PROMPT_SECTIONS.map((section) => section.trim()).join('\n\n')}\n`;
