/// <reference path="./assets.d.ts" />

import {
  OMNIDRAW_CAPSULE_ALLOWED_APIS,
  OMNIDRAW_CAPSULE_TESTED_THREE_VERSION,
} from '@omnidraw/capsule-omnidraw/contract';
import capsulePrompt from './prompt.capsule.md' with { type: 'text' };
import productAndManifestPrompt from './prompt.product-and-manifest.md' with { type: 'text' };
import serverFunctionsPrompt from './prompt.server-functions.md' with { type: 'text' };
import stateAndResourcesPrompt from './prompt.state-and-resources.md' with { type: 'text' };
import styleGuidePrompt from './prompt.style-guide.md' with { type: 'text' };
import toolsPrompt from './prompt.tools.md' with { type: 'text' };
import widgetImplementationPrompt from './prompt.widget-implementation.md' with { type: 'text' };

const capsuleAuthoringCapabilityPrompt = `
# Capsule public API groups

Supported public API groups are:
${OMNIDRAW_CAPSULE_ALLOWED_APIS.map((api) => `- \`${api}\``).join('\n')}

Every widget must explicitly request \`DOM\`. Select no more than one of
\`CANVAS_2D\`, \`WEBGL\`, and \`WEBGPU\`. Never write Capsule runtime ABIs,
DOM profiles, feature-profile names, resolved targets, bundle digests, or host
limits into \`omnidraw.json\`.

For Three.js/WebGL widgets:
- pin \`three\` to exactly \`${OMNIDRAW_CAPSULE_TESTED_THREE_VERSION}\`;
- set \`ui.apis\` to \`["DOM", "WEBGL"]\` unless another public capability is
  independently required;
- rely on the \`WEBGL\` group defaults. Add a partial \`ui.budgets\` override
  only when a verified current-process diagnostic proves a specific dimension needs it;
- stay inside the reviewed Three.js probe subset: build an explicitly indexed
  \`THREE.BufferGeometry\`, render it with a compact \`THREE.RawShaderMaterial\`,
  and animate \`Mesh\` transforms or small float/vector shader uniforms;
- every rendered geometry must have an index because the facade exposes
  \`drawElements\`, not ambient \`drawArrays\`; do not use built-in primitive
  geometries unless you replace them with an explicit index;
- keep geometry and guest-host messages bounded. If a richer supported indexed
  RawShaderMaterial scene exhausts the message ledger, request only the
  measured \`messageBytes\` value reported by diagnostics;
- do not use built-in lit/PBR materials, lights, fog, tone mapping, textures,
  blending, shadows, post-processing, or render targets. Their generated
  shaders and WebGL calls exceed the reviewed facade; a larger message budget
  only permits larger supported indexed buffers and does not make unsupported
  WebGL methods available;
- do not use \`THREE.Clock\` or the ambient \`performance\` API. Derive elapsed
  animation time from the monotonic timestamp passed to each
  \`requestAnimationFrame\` callback so animation speed stays independent of
  frame rate and Capsule scheduling;
- do not claim the widget renders until the current process has completed a
  successful \`od_widget_preview_inspect\` run with a targeted assertion for the
  current accepted generation. Use Preview mode for real manifest-bound
  behavior. Isolated \`artifact_exact\` evidence does not prove Preview
  resources, server effects, or visible-frame behavior.
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
