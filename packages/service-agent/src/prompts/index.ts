/// <reference path="./assets.d.ts" />

import {
  VIBECANVAS_CAPSULE_ALLOWED_FEATURE_PROFILES,
  VIBECANVAS_CAPSULE_BUDGET_CEILINGS,
  VIBECANVAS_CAPSULE_DEFAULT_BUDGETS,
  VIBECANVAS_CAPSULE_TESTED_THREE_VERSION,
} from '@vibecanvas/capsule-vibecanvas/contract';
import capsulePrompt from './prompt.capsule.md' with { type: 'text' };
import productAndManifestPrompt from './prompt.product-and-manifest.md' with { type: 'text' };
import serverFunctionsPrompt from './prompt.server-functions.md' with { type: 'text' };
import stateAndResourcesPrompt from './prompt.state-and-resources.md' with { type: 'text' };
import styleGuidePrompt from './prompt.style-guide.md' with { type: 'text' };
import toolsPrompt from './prompt.tools.md' with { type: 'text' };
import widgetImplementationPrompt from './prompt.widget-implementation.md' with { type: 'text' };

const capsuleAuthoringCapabilityPrompt = `
# Exact Capsule feature profiles

Supported feature profile names are:
${VIBECANVAS_CAPSULE_ALLOWED_FEATURE_PROFILES.map((profile) => `- \`${profile}\``).join('\n')}

Feature profiles are exact signed authority. Never invent, shorten, or silently
remove one to make validation pass. If the requested browser API needs a
profile, use its exact name or explain that the API is unavailable.

For Three.js/WebGL widgets:
- pin \`three\` to exactly \`${VIBECANVAS_CAPSULE_TESTED_THREE_VERSION}\`;
- include \`canvas-webgl-v1\` in \`ui.target.featureProfiles\`;
- set \`ui.budgets.gpuBytes\` to a measured positive integer no larger than
  ${VIBECANVAS_CAPSULE_BUDGET_CEILINGS.gpuBytes} bytes;
- remember that omitted \`gpuBytes\` defaults to
  ${VIBECANVAS_CAPSULE_DEFAULT_BUDGETS.gpuBytes} and therefore denies GPU use;
- stay inside the reviewed Three.js probe subset: build an explicitly indexed
  \`THREE.BufferGeometry\`, render it with a compact \`THREE.RawShaderMaterial\`,
  and animate \`Mesh\` transforms or small float/vector shader uniforms;
- every rendered geometry must have an index because the facade exposes
  \`drawElements\`, not ambient \`drawArrays\`; do not use built-in primitive
  geometries unless you replace them with an explicit index;
- keep each geometry upload within the default \`${VIBECANVAS_CAPSULE_DEFAULT_BUDGETS.messageBytes}\`-byte
  \`ui.budgets.messageBytes\` allowance. For a richer supported indexed
  RawShaderMaterial scene, request a measured bounded value such as \`262144\`
  (never above ${VIBECANVAS_CAPSULE_BUDGET_CEILINGS.messageBytes});
- do not use built-in lit/PBR materials, lights, fog, tone mapping, textures,
  blending, shadows, post-processing, or render targets. Their generated
  shaders and WebGL calls exceed the reviewed facade; a larger message budget
  only permits larger supported indexed buffers and does not make unsupported
  WebGL methods available;
- do not use \`THREE.Clock\` or the ambient \`performance\` API. Derive elapsed
  animation time from the monotonic timestamp passed to each
  \`requestAnimationFrame\` callback so animation speed stays independent of
  frame rate and Capsule scheduling;
- run construction validation, then tell the user to verify the retained
  Preview before publishing. Validation does not execute the browser guest.
`;

const WIDGET_CHAT_SYSTEM_PROMPT_SECTIONS = [
  productAndManifestPrompt,
  capsuleAuthoringCapabilityPrompt,
  toolsPrompt,
  stateAndResourcesPrompt,
  serverFunctionsPrompt,
  widgetImplementationPrompt,
  capsulePrompt,
  styleGuidePrompt,
];

export const WIDGET_CHAT_SYSTEM_PROMPT = `\n${WIDGET_CHAT_SYSTEM_PROMPT_SECTIONS.map((section) => section.trim()).join('\n\n')}\n`;
