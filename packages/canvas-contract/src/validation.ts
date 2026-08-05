import type {
  TJsonValue,
  TLayerNode,
  TSceneNode,
  TSceneSnapshot,
} from "@omnidraw/cangine";
import { validateSceneSnapshot } from "@omnidraw/cangine/testing";
import {
  fnIsCanvasColorCode,
  fnIsCanvasInkColorCode,
} from "@omnidraw/theme-contract";
import {
  CANVAS_AUTHORING_EXTENSION_KEY,
  CANVAS_IMAGE_EXTENSION_KEY,
  CANVAS_SEMANTIC_STYLE_EXTENSION_KEY,
  CANVAS_SCENE_SCHEMA_VERSION,
  CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
  CANVAS_WIDGET_EXTENSION_KEY,
} from "./CONSTANTS.js";
import type {
  TCanvasAuthoringExtensionV1,
  TCanvasContractIssue,
  TCanvasContractValidation,
  TCanvasImageExtensionV1,
  TCanvasSemanticStyleExtensionV1,
  TCanvasWidgetExtensionV1,
} from "./types.js";

const RUNTIME_ONLY_NODE_KINDS = new Set<TSceneNode["kind"]>([
  "background",
  "html-portal",
  "layer",
]);
const RESERVED_RUNTIME_NODE_IDS = new Set([
  CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
]);

const WIDGET_UI_KEYS = new Set([
  "schemaVersion",
  "type",
  "kind",
  "payload",
  "uiProps",
]);
const WIDGET_INSTANCE_KEYS = new Set([
  "schemaVersion",
  "type",
  "instanceId",
  "widgetKey",
  "resourceBindings",
  "uiProps",
]);
const WIDGET_PREVIEW_KEYS = new Set([
  "schemaVersion",
  "type",
  "instanceId",
  "widgetKey",
  "uiProps",
]);
const WIDGET_RESOURCE_BINDING_KEYS = new Set([
  "resourceId",
  "allowRead",
  "allowWrite",
]);
const WIDGET_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WIDGET_RESOURCE_SLOT_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,199}$/;
const WIDGET_KEY_MAX_LENGTH = 100;
const WIDGET_ID_MAX_LENGTH = 200;
const WIDGET_RESOURCE_BINDING_MAX_COUNT = 128;
const AUTHORING_KEYS = new Set([
  "schemaVersion",
  "locked",
  "penSource",
]);
const IMAGE_KEYS = new Set([
  "schemaVersion",
  "url",
  "mimeType",
]);
const SEMANTIC_STYLE_KEYS = new Set([
  "schemaVersion",
  "background",
  "ink",
]);
const BACKGROUND_STYLE_NODE_KINDS = new Set<TSceneNode["kind"]>([
  "rect",
  "ellipse",
  "polygon",
  "path",
  "widget-frame",
]);
const INK_STYLE_NODE_KINDS = new Set<TSceneNode["kind"]>([
  "rect",
  "ellipse",
  "polygon",
  "path",
  "connector",
  "text",
]);
const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const PEN_SOURCE_KEYS = new Set([
  "points",
  "pressures",
  "simulatePressure",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasSolidPaint(value: unknown): boolean {
  return (
    isRecord(value)
    && value.type === "solid"
    && isRecord(value.color)
  );
}

function hasSemanticBackgroundFallback(node: TSceneNode): boolean {
  if (node.kind === "widget-frame") {
    return node.titleBarColor !== undefined;
  }
  return (
    (node.kind === "rect"
      || node.kind === "ellipse"
      || node.kind === "polygon"
      || node.kind === "path")
    && hasSolidPaint(node.fill)
  );
}

function hasSemanticInkFallback(node: TSceneNode): boolean {
  if (node.kind === "text") return hasSolidPaint(node.style.fill);
  if (node.kind === "path" && node.stroke === undefined) {
    return hasSolidPaint(node.fill);
  }
  return (
    (node.kind === "rect"
      || node.kind === "ellipse"
      || node.kind === "polygon"
      || node.kind === "path"
      || node.kind === "connector")
    && node.stroke !== undefined
    && hasSolidPaint(node.stroke.paint)
  );
}

function issue(
  code: string,
  path: string,
  message: string,
  itemId?: string,
): TCanvasContractIssue {
  return itemId === undefined
    ? { code, path, message }
    : { code, path, message, itemId };
}

function validateWidgetExtension(
  node: TSceneNode,
  value: TJsonValue,
  path: string,
): TCanvasContractIssue[] {
  if (!isRecord(value)) {
    return [issue(
      "INVALID_WIDGET_EXTENSION",
      path,
      "The Omnidraw widget extension must be an object.",
      node.id,
    )];
  }
  if (node.kind !== "widget-frame") {
    return [issue(
      "WIDGET_EXTENSION_NODE_KIND",
      path,
      "The Omnidraw widget extension is allowed only on widget-frame nodes.",
      node.id,
    )];
  }
  if (value.schemaVersion !== 1) {
    return [issue(
      "WIDGET_EXTENSION_VERSION",
      `${path}/schemaVersion`,
      "The Omnidraw widget extension schemaVersion must be 1.",
      node.id,
    )];
  }
  if (value.type === "ui-widget") {
    const issues: TCanvasContractIssue[] = [];
    if (!hasOnlyKeys(value, WIDGET_UI_KEYS)) {
      issues.push(issue(
        "WIDGET_EXTENSION_FIELDS",
        path,
        "The ui-widget extension contains unsupported fields.",
        node.id,
      ));
    }
    if (!isNonEmptyString(value.kind)) {
      issues.push(issue(
        "WIDGET_EXTENSION_KIND",
        `${path}/kind`,
        "The ui-widget kind must be a non-empty string.",
        node.id,
      ));
    }
    return issues;
  }
  if (value.type === "widget-instance") {
    const issues: TCanvasContractIssue[] = [];
    if (!hasOnlyKeys(value, WIDGET_INSTANCE_KEYS)) {
      issues.push(issue(
        "WIDGET_EXTENSION_FIELDS",
        path,
        "The widget-instance extension contains unsupported fields.",
        node.id,
      ));
    }
    if (
      !isNonEmptyString(value.instanceId)
      || value.instanceId.length > WIDGET_ID_MAX_LENGTH
      || value.instanceId.trim() !== value.instanceId
    ) {
      issues.push(issue(
        "WIDGET_EXTENSION_IDENTITY",
        `${path}/instanceId`,
        "instanceId must contain 1 to 200 trimmed characters.",
        node.id,
      ));
    }
    if (
      !isNonEmptyString(value.widgetKey)
      || value.widgetKey.length > WIDGET_KEY_MAX_LENGTH
      || !WIDGET_KEY_PATTERN.test(value.widgetKey)
    ) {
      issues.push(issue(
        "WIDGET_EXTENSION_WIDGET_KEY",
        `${path}/widgetKey`,
        "widgetKey must be 1 to 100 lowercase ASCII kebab-case characters.",
        node.id,
      ));
    }
    if (value.resourceBindings !== undefined) {
      if (!isRecord(value.resourceBindings)) {
        issues.push(issue(
          "WIDGET_EXTENSION_RESOURCE_BINDINGS",
          `${path}/resourceBindings`,
          "resourceBindings must be an object keyed by manifest slot.",
          node.id,
        ));
      } else {
        const bindings = Object.entries(value.resourceBindings);
        if (bindings.length > WIDGET_RESOURCE_BINDING_MAX_COUNT) {
          issues.push(issue(
            "WIDGET_EXTENSION_RESOURCE_BINDING_LIMIT",
            `${path}/resourceBindings`,
            `resourceBindings may contain at most ${WIDGET_RESOURCE_BINDING_MAX_COUNT} slots.`,
            node.id,
          ));
        }
        for (const [slot, binding] of bindings) {
          const bindingPath = `${path}/resourceBindings/${slot}`;
          if (
            !WIDGET_RESOURCE_SLOT_PATTERN.test(slot)
          ) {
            issues.push(issue(
              "WIDGET_EXTENSION_RESOURCE_SLOT",
              bindingPath,
              "Resource slot names must match ^[A-Za-z][A-Za-z0-9._-]{0,199}$.",
              node.id,
            ));
          }
          if (!isRecord(binding) || !hasOnlyKeys(binding, WIDGET_RESOURCE_BINDING_KEYS)) {
            issues.push(issue(
              "WIDGET_EXTENSION_RESOURCE_BINDING",
              bindingPath,
              "Each resource binding must contain only resourceId, allowRead, and allowWrite.",
              node.id,
            ));
            continue;
          }
          if (
            !isNonEmptyString(binding.resourceId)
            || binding.resourceId.length > WIDGET_ID_MAX_LENGTH
            || binding.resourceId.trim() !== binding.resourceId
          ) {
            issues.push(issue(
              "WIDGET_EXTENSION_RESOURCE_ID",
              `${bindingPath}/resourceId`,
              "resourceId must contain 1 to 200 trimmed characters.",
              node.id,
            ));
          }
          if (
            typeof binding.allowRead !== "boolean"
            || typeof binding.allowWrite !== "boolean"
            || (!binding.allowRead && !binding.allowWrite)
          ) {
            issues.push(issue(
              "WIDGET_EXTENSION_RESOURCE_PERMISSIONS",
              bindingPath,
              "A resource binding must grant at least one boolean read or write permission.",
              node.id,
            ));
          }
        }
      }
    }
    return issues;
  }
  if (value.type === "widget-preview") {
    const issues: TCanvasContractIssue[] = [];
    if (!hasOnlyKeys(value, WIDGET_PREVIEW_KEYS)) {
      issues.push(issue(
        "WIDGET_EXTENSION_FIELDS",
        path,
        "The widget-preview extension contains unsupported fields.",
        node.id,
      ));
    }
    if (
      !isNonEmptyString(value.instanceId)
      || value.instanceId.length > WIDGET_ID_MAX_LENGTH
      || value.instanceId.trim() !== value.instanceId
    ) {
      issues.push(issue(
        "WIDGET_EXTENSION_IDENTITY",
        `${path}/instanceId`,
        "instanceId must contain 1 to 200 trimmed characters.",
        node.id,
      ));
    }
    if (
      !isNonEmptyString(value.widgetKey)
      || value.widgetKey.length > WIDGET_KEY_MAX_LENGTH
      || !WIDGET_KEY_PATTERN.test(value.widgetKey)
    ) {
      issues.push(issue(
        "WIDGET_EXTENSION_WIDGET_KEY",
        `${path}/widgetKey`,
        "widgetKey must be 1 to 100 lowercase ASCII kebab-case characters.",
        node.id,
      ));
    }
    return issues;
  }
  return [issue(
    "WIDGET_EXTENSION_TYPE",
    `${path}/type`,
    "The Omnidraw widget extension has an unsupported type.",
    node.id,
  )];
}

function validateAuthoringExtension(
  node: TSceneNode,
  value: TJsonValue,
  path: string,
): TCanvasContractIssue[] {
  if (!isRecord(value)) {
    return [issue(
      "INVALID_AUTHORING_EXTENSION",
      path,
      "The Omnidraw authoring extension must be an object.",
      node.id,
    )];
  }
  const issues: TCanvasContractIssue[] = [];
  if (!hasOnlyKeys(value, AUTHORING_KEYS)) {
    issues.push(issue(
      "AUTHORING_EXTENSION_FIELDS",
      path,
      "The Omnidraw authoring extension contains unsupported fields.",
      node.id,
    ));
  }
  if (value.schemaVersion !== 1) {
    issues.push(issue(
      "AUTHORING_EXTENSION_VERSION",
      `${path}/schemaVersion`,
      "The Omnidraw authoring extension schemaVersion must be 1.",
      node.id,
    ));
  }
  if (value.locked !== undefined && typeof value.locked !== "boolean") {
    issues.push(issue(
      "AUTHORING_EXTENSION_LOCKED",
      `${path}/locked`,
      "locked must be a boolean.",
      node.id,
    ));
  }
  if (value.penSource === undefined) return issues;
  if (!isRecord(value.penSource) || !hasOnlyKeys(value.penSource, PEN_SOURCE_KEYS)) {
    issues.push(issue(
      "AUTHORING_EXTENSION_PEN_SOURCE",
      `${path}/penSource`,
      "penSource must contain only points, pressures, and simulatePressure.",
      node.id,
    ));
    return issues;
  }
  const points = value.penSource.points;
  const pressures = value.penSource.pressures;
  if (
    !Array.isArray(points)
    || !points.every((point) => (
      isRecord(point)
      && Number.isFinite(point.x)
      && Number.isFinite(point.y)
    ))
  ) {
    issues.push(issue(
      "AUTHORING_EXTENSION_PEN_POINTS",
      `${path}/penSource/points`,
      "penSource points must be finite two-dimensional points.",
      node.id,
    ));
  }
  if (
    !Array.isArray(pressures)
    || !pressures.every((pressure) => Number.isFinite(pressure))
  ) {
    issues.push(issue(
      "AUTHORING_EXTENSION_PEN_PRESSURES",
      `${path}/penSource/pressures`,
      "penSource pressures must be finite numbers.",
      node.id,
    ));
  }
  if (
    Array.isArray(points)
    && Array.isArray(pressures)
    && points.length !== pressures.length
  ) {
    issues.push(issue(
      "AUTHORING_EXTENSION_PEN_LENGTH",
      `${path}/penSource`,
      "penSource points and pressures must have equal lengths.",
      node.id,
    ));
  }
  if (typeof value.penSource.simulatePressure !== "boolean") {
    issues.push(issue(
      "AUTHORING_EXTENSION_SIMULATE_PRESSURE",
      `${path}/penSource/simulatePressure`,
      "simulatePressure must be a boolean.",
      node.id,
    ));
  }
  return issues;
}

function validateImageExtension(
  node: TSceneNode,
  value: TJsonValue,
  path: string,
): TCanvasContractIssue[] {
  if (!isRecord(value)) {
    return [issue(
      "INVALID_IMAGE_EXTENSION",
      path,
      "The Omnidraw image extension must be an object.",
      node.id,
    )];
  }
  if (node.kind !== "image") {
    return [issue(
      "IMAGE_EXTENSION_NODE_KIND",
      path,
      "The Omnidraw image extension is allowed only on image nodes.",
      node.id,
    )];
  }
  const issues: TCanvasContractIssue[] = [];
  if (!hasOnlyKeys(value, IMAGE_KEYS)) {
    issues.push(issue(
      "IMAGE_EXTENSION_FIELDS",
      path,
      "The Omnidraw image extension contains unsupported fields.",
      node.id,
    ));
  }
  if (value.schemaVersion !== 1) {
    issues.push(issue(
      "IMAGE_EXTENSION_VERSION",
      `${path}/schemaVersion`,
      "The Omnidraw image extension schemaVersion must be 1.",
      node.id,
    ));
  }
  if (!isNonEmptyString(value.url)) {
    issues.push(issue(
      "IMAGE_EXTENSION_URL",
      `${path}/url`,
      "The Omnidraw image URL must be a non-empty string.",
      node.id,
    ));
  }
  if (!IMAGE_MIME_TYPES.has(String(value.mimeType))) {
    issues.push(issue(
      "IMAGE_EXTENSION_MIME_TYPE",
      `${path}/mimeType`,
      "The Omnidraw image MIME type is unsupported.",
      node.id,
    ));
  }
  return issues;
}

function validateSemanticStyleExtension(
  node: TSceneNode,
  value: TJsonValue,
  path: string,
): TCanvasContractIssue[] {
  if (!isRecord(value)) {
    return [issue(
      "INVALID_SEMANTIC_STYLE_EXTENSION",
      path,
      "The Omnidraw semantic style extension must be an object.",
      node.id,
    )];
  }
  const issues: TCanvasContractIssue[] = [];
  if (!hasOnlyKeys(value, SEMANTIC_STYLE_KEYS)) {
    issues.push(issue(
      "SEMANTIC_STYLE_EXTENSION_FIELDS",
      path,
      "The semantic style extension contains unsupported fields.",
      node.id,
    ));
  }
  if (value.schemaVersion !== 1) {
    issues.push(issue(
      "SEMANTIC_STYLE_EXTENSION_VERSION",
      `${path}/schemaVersion`,
      "The semantic style extension schemaVersion must be 1.",
      node.id,
    ));
  }
  if (value.background === undefined && value.ink === undefined) {
    issues.push(issue(
      "SEMANTIC_STYLE_EXTENSION_EMPTY",
      path,
      "The semantic style extension must contain background or ink intent.",
      node.id,
    ));
  }
  if (value.background !== undefined) {
    if (!fnIsCanvasColorCode(value.background)) {
      issues.push(issue(
        "SEMANTIC_STYLE_BACKGROUND_CODE",
        `${path}/background`,
        "background must be a supported canvas fill color code.",
        node.id,
      ));
    }
    if (!BACKGROUND_STYLE_NODE_KINDS.has(node.kind)) {
      issues.push(issue(
        "SEMANTIC_STYLE_BACKGROUND_NODE_KIND",
        `${path}/background`,
        `Node kind '${node.kind}' does not support semantic background intent.`,
        node.id,
      ));
    } else if (!hasSemanticBackgroundFallback(node)) {
      issues.push(issue(
        "SEMANTIC_STYLE_BACKGROUND_FALLBACK",
        "/fill",
        "Semantic background intent requires a concrete Cangine fill or widget title-bar fallback.",
        node.id,
      ));
    }
  }
  if (value.ink !== undefined) {
    if (!fnIsCanvasInkColorCode(value.ink)) {
      issues.push(issue(
        "SEMANTIC_STYLE_INK_CODE",
        `${path}/ink`,
        "ink must be a supported non-transparent canvas color code.",
        node.id,
      ));
    }
    if (!INK_STYLE_NODE_KINDS.has(node.kind)) {
      issues.push(issue(
        "SEMANTIC_STYLE_INK_NODE_KIND",
        `${path}/ink`,
        `Node kind '${node.kind}' does not support semantic ink intent.`,
        node.id,
      ));
    } else if (!hasSemanticInkFallback(node)) {
      issues.push(issue(
        "SEMANTIC_STYLE_INK_FALLBACK",
        node.kind === "text" ? "/style/fill" : "/stroke/paint",
        "Semantic ink intent requires a concrete solid Cangine paint fallback.",
        node.id,
      ));
    }
  }
  return issues;
}

export function fnValidateCanvasItemExtensions(
  node: TSceneNode,
): TCanvasContractValidation {
  const issues: TCanvasContractIssue[] = [];
  const widget = node.extensions?.[CANVAS_WIDGET_EXTENSION_KEY];
  if (widget !== undefined) {
    issues.push(...validateWidgetExtension(
      node,
      widget,
      `/extensions/${CANVAS_WIDGET_EXTENSION_KEY}`,
    ));
  }
  const authoring = node.extensions?.[CANVAS_AUTHORING_EXTENSION_KEY];
  if (authoring !== undefined) {
    issues.push(...validateAuthoringExtension(
      node,
      authoring,
      `/extensions/${CANVAS_AUTHORING_EXTENSION_KEY}`,
    ));
  }
  const image = node.extensions?.[CANVAS_IMAGE_EXTENSION_KEY];
  if (node.kind === "image" && image === undefined) {
    issues.push(issue(
      "IMAGE_EXTENSION_REQUIRED",
      `/extensions/${CANVAS_IMAGE_EXTENSION_KEY}`,
      "Persisted image nodes require a durable Omnidraw image extension.",
      node.id,
    ));
  } else if (image !== undefined) {
    issues.push(...validateImageExtension(
      node,
      image,
      `/extensions/${CANVAS_IMAGE_EXTENSION_KEY}`,
    ));
  }
  const semanticStyle = node.extensions?.[CANVAS_SEMANTIC_STYLE_EXTENSION_KEY];
  if (semanticStyle !== undefined) {
    issues.push(...validateSemanticStyleExtension(
      node,
      semanticStyle,
      `/extensions/${CANVAS_SEMANTIC_STYLE_EXTENSION_KEY}`,
    ));
  }
  return { valid: issues.length === 0, issues };
}

export function fnMaterializeCanvasValidationSnapshot(
  items: readonly TSceneNode[],
): TSceneSnapshot {
  const contentLayer: TLayerNode = {
    id: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
    parentId: null,
    orderKey: "0",
    kind: "layer",
    role: "content",
    coordinateSpace: "world",
    transform: {
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      skew: { x: 0, y: 0 },
      origin: { x: 0, y: 0 },
    },
  };
  return {
    schemaVersion: CANVAS_SCENE_SCHEMA_VERSION,
    rootLayerIds: [CANVAS_SYNTHETIC_CONTENT_LAYER_ID],
    nodes: [
      contentLayer,
      ...items.map((item) => (
        item.parentId === null
          ? { ...item, parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID }
          : item
      )),
    ],
  };
}

export function fnValidateCanvasItems(
  items: readonly TSceneNode[],
): TCanvasContractValidation {
  const issues: TCanvasContractIssue[] = [];
  const imageDescriptors = new Map<string, TCanvasImageExtensionV1>();
  for (const [index, item] of items.entries()) {
    if (RESERVED_RUNTIME_NODE_IDS.has(item.id)) {
      issues.push(issue(
        "RESERVED_ITEM_ID",
        `/items/${index}/id`,
        "The item ID is reserved for runtime canvas presentation.",
        item.id,
      ));
    }
    if (RUNTIME_ONLY_NODE_KINDS.has(item.kind)) {
      issues.push(issue(
        "RUNTIME_ONLY_NODE_KIND",
        `/items/${index}/kind`,
        `Node kind '${item.kind}' is runtime-owned and cannot be persisted.`,
        item.id,
      ));
    }
    if (item.kind === "widget-frame" && item.portal !== undefined) {
      issues.push(issue(
        "RUNTIME_ONLY_WIDGET_PORTAL",
        `/items/${index}/portal`,
        "Widget portal placement is runtime-owned and cannot be persisted.",
        item.id,
      ));
    }
    const extensionValidation = fnValidateCanvasItemExtensions(item);
    issues.push(...extensionValidation.issues.map((extensionIssue) => ({
      ...extensionIssue,
      path: `/items/${index}${extensionIssue.path}`,
    })));
    if (item.kind === "image") {
      const descriptor = fnReadCanvasImageExtension(item);
      const existing = imageDescriptors.get(item.resourceId);
      if (
        descriptor !== null
        && existing !== undefined
        && (
          descriptor.url !== existing.url
          || descriptor.mimeType !== existing.mimeType
        )
      ) {
        issues.push(issue(
          "IMAGE_RESOURCE_DESCRIPTOR_CONFLICT",
          `/items/${index}/extensions/${CANVAS_IMAGE_EXTENSION_KEY}`,
          `Image resource '${item.resourceId}' has conflicting durable descriptors.`,
          item.id,
        ));
      } else if (descriptor !== null && existing === undefined) {
        imageDescriptors.set(item.resourceId, descriptor);
      }
    }
  }
  if (issues.length > 0) return { valid: false, issues };

  const sceneValidation = validateSceneSnapshot(
    fnMaterializeCanvasValidationSnapshot(items),
  );
  const sceneIssues = sceneValidation.errors.map((sceneIssue) => issue(
    sceneIssue.code,
    sceneIssue.path,
    sceneIssue.message,
    sceneIssue.nodeId,
  ));
  return {
    valid: sceneIssues.length === 0,
    issues: sceneIssues,
  };
}

export function fnAssertValidCanvasItems(
  items: readonly TSceneNode[],
): asserts items is readonly TSceneNode[] {
  const validation = fnValidateCanvasItems(items);
  if (validation.valid) return;
  const summary = validation.issues
    .map((entry) => `${entry.code} at ${entry.path}: ${entry.message}`)
    .join("\n");
  throw new TypeError(`Invalid authored canvas items:\n${summary}`);
}

export function fnReadCanvasWidgetExtension(
  node: TSceneNode,
): TCanvasWidgetExtensionV1 | null {
  const value = node.extensions?.[CANVAS_WIDGET_EXTENSION_KEY];
  if (value === undefined) return null;
  const validation = validateWidgetExtension(
    node,
    value,
    `/extensions/${CANVAS_WIDGET_EXTENSION_KEY}`,
  );
  if (validation.length > 0) return null;
  return value as TCanvasWidgetExtensionV1;
}

export function fnReadCanvasAuthoringExtension(
  node: TSceneNode,
): TCanvasAuthoringExtensionV1 | null {
  const value = node.extensions?.[CANVAS_AUTHORING_EXTENSION_KEY];
  if (value === undefined) return null;
  const validation = validateAuthoringExtension(
    node,
    value,
    `/extensions/${CANVAS_AUTHORING_EXTENSION_KEY}`,
  );
  if (validation.length > 0) return null;
  return value as unknown as TCanvasAuthoringExtensionV1;
}

export function fnReadCanvasImageExtension(
  node: TSceneNode,
): TCanvasImageExtensionV1 | null {
  const value = node.extensions?.[CANVAS_IMAGE_EXTENSION_KEY];
  if (value === undefined) return null;
  const validation = validateImageExtension(
    node,
    value,
    `/extensions/${CANVAS_IMAGE_EXTENSION_KEY}`,
  );
  if (validation.length > 0) return null;
  return value as unknown as TCanvasImageExtensionV1;
}

export function fnReadCanvasSemanticStyleExtension(
  node: TSceneNode,
): TCanvasSemanticStyleExtensionV1 | null {
  const value = node.extensions?.[CANVAS_SEMANTIC_STYLE_EXTENSION_KEY];
  if (value === undefined) return null;
  const validation = validateSemanticStyleExtension(
    node,
    value,
    `/extensions/${CANVAS_SEMANTIC_STYLE_EXTENSION_KEY}`,
  );
  if (validation.length > 0) return null;
  return value as unknown as TCanvasSemanticStyleExtensionV1;
}
