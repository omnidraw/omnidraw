import {
  CANVAS_AUTHORING_EXTENSION_KEY,
  CANVAS_COMMAND_MAX_OPERATIONS,
  CANVAS_IMAGE_EXTENSION_KEY,
  CANVAS_QUERY_MAX_LIMIT,
  CANVAS_SCENE_SCHEMA_VERSION,
  CANVAS_SEMANTIC_STYLE_EXTENSION_KEY,
  CANVAS_WIDGET_EXTENSION_KEY,
} from "./CONSTANTS.js";
import type {
  TCanvasAuthoringExtensionV1,
  TCanvasCommand,
  TCanvasContractIssue,
  TCanvasContractValidation,
  TCanvasDocument,
  TCanvasEvent,
  TCanvasImageExtensionV1,
  TCanvasItemPage,
  TCanvasItemQuery,
  TCanvasItemSnapshot,
  TCanvasSceneNode,
  TCanvasSemanticStyleExtensionV1,
  TCanvasWidgetExtensionV1,
} from "./types.js";

type R = Record<string, unknown>;
type Issues = TCanvasContractIssue[];

const BASE_NODE_KEYS = [
  "id", "parentId", "orderKey", "kind", "transform", "visibility",
  "opacity", "blendMode", "pointerEvents", "clip", "effects",
  "accessibility", "metadata", "extensions",
] as const;
const AUTHORED_KINDS = new Set([
  "group", "rect", "ellipse", "polygon", "path", "image", "connector",
  "widget-frame", "text",
]);
const RUNTIME_ONLY_KINDS = new Set(["layer", "background", "html-portal"]);
const FILL_CODES = new Set([
  "transparent", "neutral", "red", "yellow", "green", "blue",
]);
const INK_CODES = new Set(["neutral", "red", "yellow", "green", "blue"]);
const BACKGROUND_STYLE_KINDS = new Set([
  "rect", "ellipse", "polygon", "path", "widget-frame",
]);
const INK_STYLE_KINDS = new Set([
  "rect", "ellipse", "polygon", "path", "connector", "text",
]);
const WIDGET_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TIMESTAMP_SEC = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function pointerPart(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function child(path: string, key: string | number): string {
  return `${path}/${typeof key === "number" ? key : pointerPart(key)}`;
}

function add(
  issues: Issues,
  code: string,
  path: string,
  message: string,
  itemId?: string,
): void {
  issues.push(itemId === undefined
    ? { code, path, message }
    : { code, path, message, itemId });
}

function isPlainRecord(value: unknown): value is R {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function preflight(value: unknown, path: string, issues: Issues): void {
  const ancestors = new Set<object>();
  const visit = (current: unknown, currentPath: string): void => {
    if (current === null || typeof current === "string" || typeof current === "boolean") return;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        add(issues, "NON_FINITE_NUMBER", currentPath, "Numbers must be finite.");
      }
      return;
    }
    if (typeof current !== "object") {
      add(issues, "NON_JSON_VALUE", currentPath, "Values must be JSON-compatible.");
      return;
    }
    if (ancestors.has(current)) {
      add(issues, "CYCLIC_VALUE", currentPath, "Cyclic values are not serializable.");
      return;
    }
    if (!Array.isArray(current) && !isPlainRecord(current)) {
      add(issues, "NON_PLAIN_OBJECT", currentPath, "Objects must have a plain or null prototype.");
      return;
    }
    ancestors.add(current);
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        if (!(index in current)) {
          add(issues, "SPARSE_ARRAY", child(currentPath, index), "Arrays cannot contain holes.");
        } else {
          visit(current[index], child(currentPath, index));
        }
      }
    } else {
      for (const key of Object.keys(current).sort()) {
        visit((current as R)[key], child(currentPath, key));
      }
    }
    ancestors.delete(current);
  };
  visit(value, path);
}

function record(
  value: unknown,
  path: string,
  issues: Issues,
  allowed: readonly string[],
): R | null {
  if (!isPlainRecord(value)) {
    add(issues, "INVALID_TYPE", path, "Expected an object.");
    return null;
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value).sort()) {
    if (!allowedSet.has(key)) {
      add(issues, "UNEXPECTED_FIELD", child(path, key), `Field '${key}' is not supported.`);
    }
  }
  return value;
}

function has(value: R, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function stringValue(
  value: unknown,
  path: string,
  issues: Issues,
  options: { nonEmpty?: boolean; max?: number; pattern?: RegExp } = {},
): value is string {
  if (typeof value !== "string") {
    add(issues, "INVALID_STRING", path, "Expected a string.");
    return false;
  }
  if (options.nonEmpty && value.length === 0) {
    add(issues, "EMPTY_STRING", path, "Expected a non-empty string.");
    return false;
  }
  if (options.max !== undefined && value.length > options.max) {
    add(issues, "STRING_TOO_LONG", path, `String must contain at most ${options.max} characters.`);
    return false;
  }
  if (options.pattern !== undefined && !options.pattern.test(value)) {
    add(issues, "INVALID_STRING_FORMAT", path, "String has an invalid format.");
    return false;
  }
  return true;
}

function booleanValue(value: unknown, path: string, issues: Issues): value is boolean {
  if (typeof value === "boolean") return true;
  add(issues, "INVALID_BOOLEAN", path, "Expected a boolean.");
  return false;
}

function numberValue(
  value: unknown,
  path: string,
  issues: Issues,
  options: { min?: number; max?: number; integer?: boolean } = {},
): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    add(issues, "INVALID_NUMBER", path, "Expected a finite number.");
    return false;
  }
  if (options.integer && !Number.isSafeInteger(value)) {
    add(issues, "INVALID_INTEGER", path, "Expected a safe integer.");
    return false;
  }
  if (options.min !== undefined && value < options.min) {
    add(issues, "NUMBER_TOO_SMALL", path, `Number must be at least ${options.min}.`);
    return false;
  }
  if (options.max !== undefined && value > options.max) {
    add(issues, "NUMBER_TOO_LARGE", path, `Number must be at most ${options.max}.`);
    return false;
  }
  return true;
}

function enumValue(
  value: unknown,
  path: string,
  issues: Issues,
  allowed: readonly string[],
): value is string {
  if (typeof value === "string" && allowed.includes(value)) return true;
  add(issues, "INVALID_ENUM_VALUE", path, `Expected one of: ${allowed.join(", ")}.`);
  return false;
}

function arrayValue(
  value: unknown,
  path: string,
  issues: Issues,
  validate: (entry: unknown, entryPath: string, issues: Issues) => void,
  options: { min?: number; max?: number } = {},
): value is unknown[] {
  if (!Array.isArray(value)) {
    add(issues, "INVALID_ARRAY", path, "Expected an array.");
    return false;
  }
  if (options.min !== undefined && value.length < options.min) {
    add(issues, "ARRAY_TOO_SHORT", path, `Array must contain at least ${options.min} entries.`);
  }
  if (options.max !== undefined && value.length > options.max) {
    add(issues, "ARRAY_TOO_LONG", path, `Array must contain at most ${options.max} entries.`);
  }
  value.forEach((entry, index) => validate(entry, child(path, index), issues));
  return true;
}

function optional(
  value: R,
  key: string,
  path: string,
  issues: Issues,
  validate: (entry: unknown, entryPath: string, issues: Issues) => void,
): void {
  if (has(value, key)) validate(value[key], child(path, key), issues);
}

function validateVec2(value: unknown, path: string, issues: Issues): void {
  const object = record(value, path, issues, ["x", "y"]);
  if (object === null) return;
  numberValue(object.x, child(path, "x"), issues);
  numberValue(object.y, child(path, "y"), issues);
}

function validateSize(value: unknown, path: string, issues: Issues): void {
  const object = record(value, path, issues, ["width", "height"]);
  if (object === null) return;
  numberValue(object.width, child(path, "width"), issues, { min: 0 });
  numberValue(object.height, child(path, "height"), issues, { min: 0 });
}

function validateInsets(value: unknown, path: string, issues: Issues): void {
  const object = record(value, path, issues, ["top", "right", "bottom", "left"]);
  if (object === null) return;
  for (const key of ["top", "right", "bottom", "left"] as const) {
    numberValue(object[key], child(path, key), issues, { min: 0 });
  }
}

function validateRect(value: unknown, path: string, issues: Issues): void {
  const object = record(value, path, issues, ["x", "y", "width", "height"]);
  if (object === null) return;
  numberValue(object.x, child(path, "x"), issues);
  numberValue(object.y, child(path, "y"), issues);
  numberValue(object.width, child(path, "width"), issues, { min: 0 });
  numberValue(object.height, child(path, "height"), issues, { min: 0 });
}

function validateTransform(value: unknown, path: string, issues: Issues): void {
  const object = record(value, path, issues, ["position", "rotation", "scale", "skew", "origin"]);
  if (object === null) return;
  validateVec2(object.position, child(path, "position"), issues);
  numberValue(object.rotation, child(path, "rotation"), issues);
  validateVec2(object.scale, child(path, "scale"), issues);
  validateVec2(object.skew, child(path, "skew"), issues);
  validateVec2(object.origin, child(path, "origin"), issues);
}

function validateColor(value: unknown, path: string, issues: Issues): void {
  const object = record(value, path, issues, ["space", "r", "g", "b", "a"]);
  if (object === null) return;
  enumValue(object.space, child(path, "space"), issues, ["srgb", "display-p3"]);
  for (const key of ["r", "g", "b", "a"] as const) {
    numberValue(object[key], child(path, key), issues, { min: 0, max: 1 });
  }
}

function validateCorner(value: unknown, path: string, issues: Issues): void {
  const keys = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;
  const object = record(value, path, issues, keys);
  if (object === null) return;
  for (const key of keys) numberValue(object[key], child(path, key), issues, { min: 0 });
}

function validatePathCommand(value: unknown, path: string, issues: Issues): void {
  if (!isPlainRecord(value)) {
    add(issues, "INVALID_PATH_COMMAND", path, "Path commands must be objects.");
    return;
  }
  switch (value.type) {
    case "M":
    case "L": {
      const object = record(value, path, issues, ["type", "to"]);
      if (object) validateVec2(object.to, child(path, "to"), issues);
      return;
    }
    case "Q": {
      const object = record(value, path, issues, ["type", "control", "to"]);
      if (object) {
        validateVec2(object.control, child(path, "control"), issues);
        validateVec2(object.to, child(path, "to"), issues);
      }
      return;
    }
    case "C": {
      const object = record(value, path, issues, ["type", "control1", "control2", "to"]);
      if (object) {
        validateVec2(object.control1, child(path, "control1"), issues);
        validateVec2(object.control2, child(path, "control2"), issues);
        validateVec2(object.to, child(path, "to"), issues);
      }
      return;
    }
    case "A": {
      const object = record(value, path, issues, [
        "type", "radius", "xAxisRotation", "largeArc", "sweep", "to",
      ]);
      if (object) {
        validateVec2(object.radius, child(path, "radius"), issues);
        numberValue(object.xAxisRotation, child(path, "xAxisRotation"), issues);
        booleanValue(object.largeArc, child(path, "largeArc"), issues);
        booleanValue(object.sweep, child(path, "sweep"), issues);
        validateVec2(object.to, child(path, "to"), issues);
      }
      return;
    }
    case "Z":
      record(value, path, issues, ["type"]);
      return;
    default:
      add(issues, "INVALID_PATH_COMMAND", child(path, "type"), "Unsupported path command type.");
  }
}

function validatePathData(value: unknown, path: string, issues: Issues): void {
  const object = record(value, path, issues, ["commands", "fillRule"]);
  if (object === null) return;
  arrayValue(object.commands, child(path, "commands"), issues, validatePathCommand);
  optional(object, "fillRule", path, issues, (entry, entryPath, list) => {
    enumValue(entry, entryPath, list, ["nonzero", "evenodd"]);
  });
}

function validatePaint(value: unknown, path: string, issues: Issues): void {
  if (!isPlainRecord(value)) {
    add(issues, "INVALID_PAINT", path, "Paint must be an object.");
    return;
  }
  if (value.type === "solid") {
    const object = record(value, path, issues, ["type", "color"]);
    if (object) validateColor(object.color, child(path, "color"), issues);
    return;
  }
  if (value.type === "linear-gradient") {
    const object = record(value, path, issues, ["type", "from", "to", "stops", "space"]);
    if (object) {
      validateVec2(object.from, child(path, "from"), issues);
      validateVec2(object.to, child(path, "to"), issues);
      validateGradientStops(object.stops, child(path, "stops"), issues);
      optional(object, "space", path, issues, (entry, entryPath, list) => {
        enumValue(entry, entryPath, list, ["local", "world"]);
      });
    }
    return;
  }
  if (value.type === "radial-gradient") {
    const object = record(value, path, issues, ["type", "center", "radius", "focalPoint", "stops", "space"]);
    if (object) {
      validateVec2(object.center, child(path, "center"), issues);
      numberValue(object.radius, child(path, "radius"), issues, { min: 0 });
      optional(object, "focalPoint", path, issues, validateVec2);
      validateGradientStops(object.stops, child(path, "stops"), issues);
      optional(object, "space", path, issues, (entry, entryPath, list) => {
        enumValue(entry, entryPath, list, ["local", "world"]);
      });
    }
    return;
  }
  if (value.type === "image-pattern") {
    const object = record(value, path, issues, ["type", "resourceId", "transform", "repeat"]);
    if (object) {
      stringValue(object.resourceId, child(path, "resourceId"), issues, { nonEmpty: true });
      optional(object, "transform", path, issues, validateTransform);
      optional(object, "repeat", path, issues, (entry, entryPath, list) => {
        enumValue(entry, entryPath, list, ["repeat", "repeat-x", "repeat-y", "no-repeat"]);
      });
    }
    return;
  }
  add(issues, "INVALID_PAINT", child(path, "type"), "Unsupported paint type.");
}

function validateGradientStops(value: unknown, path: string, issues: Issues): void {
  arrayValue(value, path, issues, (entry, entryPath, list) => {
    const object = record(entry, entryPath, list, ["offset", "color"]);
    if (object === null) return;
    numberValue(object.offset, child(entryPath, "offset"), list, { min: 0, max: 1 });
    validateColor(object.color, child(entryPath, "color"), list);
  }, { min: 1 });
}

function validateStroke(value: unknown, path: string, issues: Issues): void {
  const object = record(value, path, issues, [
    "paint", "width", "alignment", "cap", "join", "miterLimit", "dash", "dashOffset",
  ]);
  if (object === null) return;
  validatePaint(object.paint, child(path, "paint"), issues);
  numberValue(object.width, child(path, "width"), issues, { min: 0 });
  optional(object, "alignment", path, issues, (entry, entryPath, list) => {
    enumValue(entry, entryPath, list, ["center", "inside", "outside"]);
  });
  optional(object, "cap", path, issues, (entry, entryPath, list) => {
    enumValue(entry, entryPath, list, ["butt", "round", "square"]);
  });
  optional(object, "join", path, issues, (entry, entryPath, list) => {
    enumValue(entry, entryPath, list, ["miter", "round", "bevel"]);
  });
  optional(object, "miterLimit", path, issues, (entry, entryPath, list) => {
    numberValue(entry, entryPath, list, { min: 0 });
  });
  optional(object, "dash", path, issues, (entry, entryPath, list) => {
    arrayValue(entry, entryPath, list, (part, partPath, partIssues) => {
      numberValue(part, partPath, partIssues, { min: 0 });
    });
  });
  optional(object, "dashOffset", path, issues, numberValue);
}

function validateClip(value: unknown, path: string, issues: Issues): void {
  if (!isPlainRecord(value)) {
    add(issues, "INVALID_CLIP", path, "Clip must be an object.");
    return;
  }
  if (value.type === "rect") {
    const object = record(value, path, issues, ["type", "rect", "radius"]);
    if (object) {
      validateRect(object.rect, child(path, "rect"), issues);
      optional(object, "radius", path, issues, validateCorner);
    }
  } else if (value.type === "path") {
    const object = record(value, path, issues, ["type", "path"]);
    if (object) validatePathData(object.path, child(path, "path"), issues);
  } else if (value.type === "node") {
    const object = record(value, path, issues, ["type", "nodeId"]);
    if (object) stringValue(object.nodeId, child(path, "nodeId"), issues, { nonEmpty: true });
  } else {
    add(issues, "INVALID_CLIP", child(path, "type"), "Unsupported clip type.");
  }
}

function validateEffect(value: unknown, path: string, issues: Issues): void {
  if (!isPlainRecord(value)) {
    add(issues, "INVALID_EFFECT", path, "Effect must be an object.");
    return;
  }
  if (value.type === "shadow") {
    const object = record(value, path, issues, ["type", "color", "offset", "blur", "spread", "inset"]);
    if (object) {
      validateColor(object.color, child(path, "color"), issues);
      validateVec2(object.offset, child(path, "offset"), issues);
      numberValue(object.blur, child(path, "blur"), issues, { min: 0 });
      optional(object, "spread", path, issues, numberValue);
      optional(object, "inset", path, issues, booleanValue);
    }
  } else if (value.type === "blur") {
    const object = record(value, path, issues, ["type", "radius"]);
    if (object) numberValue(object.radius, child(path, "radius"), issues, { min: 0 });
  } else if (value.type === "color-matrix") {
    const object = record(value, path, issues, ["type", "matrix"]);
    if (object && arrayValue(object.matrix, child(path, "matrix"), issues, numberValue)) {
      if (object.matrix.length !== 20) {
        add(issues, "INVALID_COLOR_MATRIX", child(path, "matrix"), "A color matrix must contain exactly 20 numbers.");
      }
    }
  } else {
    add(issues, "INVALID_EFFECT", child(path, "type"), "Unsupported effect type.");
  }
}

function validateAccessibility(value: unknown, path: string, issues: Issues): void {
  const object = record(value, path, issues, ["role", "label", "description", "tabIndex", "hidden"]);
  if (object === null) return;
  for (const key of ["role", "label", "description"] as const) {
    optional(object, key, path, issues, stringValue);
  }
  optional(object, "tabIndex", path, issues, (entry, entryPath, list) => {
    numberValue(entry, entryPath, list, { integer: true });
  });
  optional(object, "hidden", path, issues, booleanValue);
}

function validateJsonObject(value: unknown, path: string, issues: Issues): void {
  if (!isPlainRecord(value)) add(issues, "INVALID_JSON_OBJECT", path, "Expected a JSON object.");
}

function validateBaseNode(object: R, path: string, issues: Issues): void {
  stringValue(object.id, child(path, "id"), issues, { nonEmpty: true, max: 200 });
  if (object.parentId !== null) {
    stringValue(object.parentId, child(path, "parentId"), issues, { nonEmpty: true, max: 200 });
  }
  stringValue(object.orderKey, child(path, "orderKey"), issues, { nonEmpty: true, max: 500 });
  validateTransform(object.transform, child(path, "transform"), issues);
  optional(object, "visibility", path, issues, (entry, entryPath, list) => {
    enumValue(entry, entryPath, list, ["visible", "hidden", "inherited"]);
  });
  optional(object, "opacity", path, issues, (entry, entryPath, list) => {
    numberValue(entry, entryPath, list, { min: 0, max: 1 });
  });
  optional(object, "blendMode", path, issues, (entry, entryPath, list) => {
    enumValue(entry, entryPath, list, [
      "normal", "multiply", "screen", "overlay", "darken", "lighten", "difference", "exclusion",
    ]);
  });
  optional(object, "pointerEvents", path, issues, (entry, entryPath, list) => {
    enumValue(entry, entryPath, list, ["auto", "none", "bounds-only", "painted"]);
  });
  optional(object, "clip", path, issues, validateClip);
  optional(object, "effects", path, issues, (entry, entryPath, list) => {
    arrayValue(entry, entryPath, list, validateEffect);
  });
  optional(object, "accessibility", path, issues, validateAccessibility);
  optional(object, "metadata", path, issues, validateJsonObject);
  optional(object, "extensions", path, issues, validateJsonObject);
}

function validateLayout(value: unknown, path: string, issues: Issues): void {
  if (!isPlainRecord(value)) {
    add(issues, "INVALID_GROUP_LAYOUT", path, "Group layout must be an object.");
  } else if (value.type === "free") {
    record(value, path, issues, ["type"]);
  } else if (value.type === "stack") {
    const object = record(value, path, issues, ["type", "axis", "gap", "padding", "align"]);
    if (object) {
      enumValue(object.axis, child(path, "axis"), issues, ["horizontal", "vertical"]);
      numberValue(object.gap, child(path, "gap"), issues, { min: 0 });
      validateInsets(object.padding, child(path, "padding"), issues);
      enumValue(object.align, child(path, "align"), issues, ["start", "center", "end", "stretch"]);
    }
  } else {
    add(issues, "INVALID_GROUP_LAYOUT", child(path, "type"), "Unsupported group layout type.");
  }
}

function validateEndpoint(value: unknown, path: string, issues: Issues): void {
  if (!isPlainRecord(value)) {
    add(issues, "INVALID_CONNECTOR_ENDPOINT", path, "Connector endpoint must be an object.");
  } else if (value.type === "point") {
    const object = record(value, path, issues, ["type", "point"]);
    if (object) validateVec2(object.point, child(path, "point"), issues);
  } else if (value.type === "node") {
    const object = record(value, path, issues, ["type", "nodeId", "anchor", "offset", "gap"]);
    if (object) {
      stringValue(object.nodeId, child(path, "nodeId"), issues, { nonEmpty: true });
      if (typeof object.anchor === "string") {
        enumValue(object.anchor, child(path, "anchor"), issues, [
          "auto", "center", "top", "right", "bottom", "left", "top-left", "top-right", "bottom-right", "bottom-left",
        ]);
      } else {
        const anchor = record(object.anchor, child(path, "anchor"), issues, ["name"]);
        if (anchor) stringValue(anchor.name, child(child(path, "anchor"), "name"), issues, { nonEmpty: true });
      }
      optional(object, "offset", path, issues, validateVec2);
      optional(object, "gap", path, issues, (entry, entryPath, list) => numberValue(entry, entryPath, list, { min: 0 }));
    }
  } else {
    add(issues, "INVALID_CONNECTOR_ENDPOINT", child(path, "type"), "Unsupported connector endpoint type.");
  }
}

function validateRouting(value: unknown, path: string, issues: Issues): void {
  if (!isPlainRecord(value)) {
    add(issues, "INVALID_CONNECTOR_ROUTING", path, "Connector routing must be an object.");
    return;
  }
  if (value.type === "straight") {
    record(value, path, issues, ["type"]);
  } else if (value.type === "orthogonal") {
    const object = record(value, path, issues, ["type", "cornerRadius", "preferredAxis", "obstaclePadding"]);
    if (object) {
      optional(object, "cornerRadius", path, issues, (entry, entryPath, list) => numberValue(entry, entryPath, list, { min: 0 }));
      optional(object, "preferredAxis", path, issues, (entry, entryPath, list) => enumValue(entry, entryPath, list, ["horizontal", "vertical"]));
      optional(object, "obstaclePadding", path, issues, (entry, entryPath, list) => numberValue(entry, entryPath, list, { min: 0 }));
    }
  } else if (value.type === "quadratic") {
    const object = record(value, path, issues, ["type", "control"]);
    if (object) optional(object, "control", path, issues, validateVec2);
  } else if (value.type === "bezier") {
    const object = record(value, path, issues, ["type", "control1", "control2"]);
    if (object) {
      optional(object, "control1", path, issues, validateVec2);
      optional(object, "control2", path, issues, validateVec2);
    }
  } else if (value.type === "manual") {
    const object = record(value, path, issues, ["type", "path"]);
    if (object) validatePathData(object.path, child(path, "path"), issues);
  } else {
    add(issues, "INVALID_CONNECTOR_ROUTING", child(path, "type"), "Unsupported connector routing type.");
  }
}

function validateMarker(value: unknown, path: string, issues: Issues): void {
  const object = record(value, path, issues, ["shape", "size", "filled"]);
  if (object === null) return;
  enumValue(object.shape, child(path, "shape"), issues, ["none", "arrow", "triangle", "circle", "diamond", "bar"]);
  numberValue(object.size, child(path, "size"), issues, { min: 0 });
  optional(object, "filled", path, issues, booleanValue);
}

function validateWidgetContent(value: unknown, path: string, issues: Issues): void {
  if (!isPlainRecord(value)) {
    add(issues, "INVALID_WIDGET_HEADER_CONTENT", path, "Widget header content must be an object.");
  } else if (value.type === "text") {
    const object = record(value, path, issues, ["type", "text"]);
    if (object) stringValue(object.text, child(path, "text"), issues);
  } else if (value.type === "icon") {
    const object = record(value, path, issues, ["type", "resourceId"]);
    if (object) stringValue(object.resourceId, child(path, "resourceId"), issues, { nonEmpty: true });
  } else {
    add(issues, "INVALID_WIDGET_HEADER_CONTENT", child(path, "type"), "Unsupported widget header content type.");
  }
}

function validateWidgetHeaderItem(value: unknown, path: string, issues: Issues): void {
  if (!isPlainRecord(value)) {
    add(issues, "INVALID_WIDGET_HEADER_ITEM", path, "Widget header item must be an object.");
    return;
  }
  const shared = (object: R): void => {
    stringValue(object.id, child(path, "id"), issues, { nonEmpty: true });
    stringValue(object.label, child(path, "label"), issues, { nonEmpty: true });
    validateWidgetContent(object.content, child(path, "content"), issues);
    optional(object, "disabled", path, issues, booleanValue);
  };
  if (value.type === "button") {
    const object = record(value, path, issues, ["type", "id", "label", "content", "disabled"]);
    if (object) shared(object);
  } else if (value.type === "dropdown") {
    const object = record(value, path, issues, ["type", "id", "label", "content", "items", "disabled"]);
    if (object) {
      shared(object);
      arrayValue(object.items, child(path, "items"), issues, (entry, entryPath, list) => {
        const dropdown = record(entry, entryPath, list, ["id", "text", "disabled"]);
        if (dropdown) {
          stringValue(dropdown.id, child(entryPath, "id"), list, { nonEmpty: true });
          stringValue(dropdown.text, child(entryPath, "text"), list);
          optional(dropdown, "disabled", entryPath, list, booleanValue);
        }
      });
    }
  } else {
    add(issues, "INVALID_WIDGET_HEADER_ITEM", child(path, "type"), "Unsupported widget header item type.");
  }
}

function validateTextStyle(
  value: unknown,
  path: string,
  issues: Issues,
  partial = false,
): void {
  const keys = [
    "fontFamilies", "fontSize", "fontWeight", "fontStyle", "fontStretch",
    "letterSpacing", "wordSpacing", "lineHeight", "fill", "stroke",
    "decoration", "language", "features",
  ];
  const object = record(value, path, issues, keys);
  if (object === null) return;
  const required = <T>(key: string, validate: (entry: unknown, entryPath: string, list: Issues) => T): void => {
    if (!partial || has(object, key)) validate(object[key], child(path, key), issues);
  };
  required("fontFamilies", (entry, entryPath, list) => arrayValue(entry, entryPath, list, (family, familyPath, familyIssues) => {
    stringValue(family, familyPath, familyIssues, { nonEmpty: true });
  }, { min: 1 }));
  required("fontSize", (entry, entryPath, list) => numberValue(entry, entryPath, list, { min: 0 }));
  required("fill", validatePaint);
  optional(object, "fontWeight", path, issues, (entry, entryPath, list) => numberValue(entry, entryPath, list, { min: 1 }));
  optional(object, "fontStyle", path, issues, (entry, entryPath, list) => enumValue(entry, entryPath, list, ["normal", "italic", "oblique"]));
  for (const key of ["fontStretch", "letterSpacing", "wordSpacing", "lineHeight"] as const) {
    optional(object, key, path, issues, numberValue);
  }
  optional(object, "stroke", path, issues, validateStroke);
  optional(object, "decoration", path, issues, (entry, entryPath, list) => enumValue(entry, entryPath, list, ["none", "underline", "line-through", "overline"]));
  optional(object, "language", path, issues, stringValue);
  optional(object, "features", path, issues, (entry, entryPath, list) => {
    if (!isPlainRecord(entry)) {
      add(list, "INVALID_TEXT_FEATURES", entryPath, "Text features must be an object.");
      return;
    }
    for (const key of Object.keys(entry).sort()) {
      const feature = entry[key];
      if (typeof feature !== "boolean") numberValue(feature, child(entryPath, key), list);
    }
  });
}

function validateTextLayout(value: unknown, path: string, issues: Issues): void {
  if (!isPlainRecord(value)) {
    add(issues, "INVALID_TEXT_LAYOUT", path, "Text layout must be an object.");
  } else if (value.type === "auto-width") {
    const object = record(value, path, issues, ["type", "maxWidth"]);
    if (object) optional(object, "maxWidth", path, issues, (entry, entryPath, list) => numberValue(entry, entryPath, list, { min: 0 }));
  } else if (value.type === "auto-height") {
    const object = record(value, path, issues, ["type", "width"]);
    if (object) numberValue(object.width, child(path, "width"), issues, { min: 0 });
  } else if (value.type === "fixed") {
    const object = record(value, path, issues, ["type", "size", "overflow"]);
    if (object) {
      validateSize(object.size, child(path, "size"), issues);
      optional(object, "overflow", path, issues, (entry, entryPath, list) => enumValue(entry, entryPath, list, ["clip", "ellipsis", "visible"]));
    }
  } else {
    add(issues, "INVALID_TEXT_LAYOUT", child(path, "type"), "Unsupported text layout type.");
  }
}

function validateNode(value: unknown, path: string, issues: Issues): value is TCanvasSceneNode {
  if (!isPlainRecord(value)) {
    add(issues, "INVALID_NODE", path, "Canvas nodes must be objects.");
    return false;
  }
  if (typeof value.kind === "string" && RUNTIME_ONLY_KINDS.has(value.kind)) {
    add(issues, "RUNTIME_ONLY_NODE_KIND", child(path, "kind"), `Node kind '${value.kind}' is runtime-only.`);
    return false;
  }
  if (value.kind === "view-3d") {
    add(issues, "UNSUPPORTED_AUTHORED_NODE_KIND", child(path, "kind"), "view-3d is not part of the authored Canvas document.");
    return false;
  }
  if (typeof value.kind !== "string" || !AUTHORED_KINDS.has(value.kind)) {
    add(issues, "INVALID_NODE_KIND", child(path, "kind"), "Unsupported authored node kind.");
    return false;
  }

  const extras: Record<string, readonly string[]> = {
    group: ["layout", "isolateBlend"],
    rect: ["size", "radius", "fill", "stroke"],
    ellipse: ["size", "fill", "stroke"],
    polygon: ["points", "closed", "fill", "stroke", "fillRule"],
    path: ["path", "fill", "stroke"],
    image: ["resourceId", "size", "fit", "position", "smoothing", "crop", "tint"],
    connector: ["from", "to", "routing", "waypoints", "stroke", "startMarker", "endMarker", "avoidNodeIds", "labelNodeId"],
    "widget-frame": ["size", "title", "titleBarColor", "headerItems", "collapsed", "resizable", "minSize", "maxSize"],
    text: ["runs", "style", "layout", "align", "verticalAlign", "direction", "wrap", "selectable"],
  };
  const object = record(value, path, issues, [...BASE_NODE_KEYS, ...extras[value.kind]!]);
  if (object === null) return false;
  validateBaseNode(object, path, issues);

  switch (value.kind) {
    case "group":
      optional(object, "layout", path, issues, validateLayout);
      optional(object, "isolateBlend", path, issues, booleanValue);
      break;
    case "rect":
      validateSize(object.size, child(path, "size"), issues);
      if (has(object, "radius")) {
        if (typeof object.radius === "number") numberValue(object.radius, child(path, "radius"), issues, { min: 0 });
        else validateCorner(object.radius, child(path, "radius"), issues);
      }
      optional(object, "fill", path, issues, validatePaint);
      optional(object, "stroke", path, issues, validateStroke);
      break;
    case "ellipse":
      validateSize(object.size, child(path, "size"), issues);
      optional(object, "fill", path, issues, validatePaint);
      optional(object, "stroke", path, issues, validateStroke);
      break;
    case "polygon":
      arrayValue(object.points, child(path, "points"), issues, validateVec2);
      booleanValue(object.closed, child(path, "closed"), issues);
      optional(object, "fill", path, issues, validatePaint);
      optional(object, "stroke", path, issues, validateStroke);
      optional(object, "fillRule", path, issues, (entry, entryPath, list) => enumValue(entry, entryPath, list, ["nonzero", "evenodd"]));
      break;
    case "path":
      validatePathData(object.path, child(path, "path"), issues);
      optional(object, "fill", path, issues, validatePaint);
      optional(object, "stroke", path, issues, validateStroke);
      break;
    case "image":
      stringValue(object.resourceId, child(path, "resourceId"), issues, { nonEmpty: true });
      validateSize(object.size, child(path, "size"), issues);
      optional(object, "fit", path, issues, (entry, entryPath, list) => enumValue(entry, entryPath, list, ["fill", "contain", "cover", "none", "scale-down"]));
      optional(object, "position", path, issues, validateVec2);
      optional(object, "smoothing", path, issues, (entry, entryPath, list) => enumValue(entry, entryPath, list, ["auto", "pixelated"]));
      optional(object, "crop", path, issues, validateRect);
      optional(object, "tint", path, issues, validateColor);
      break;
    case "connector":
      validateEndpoint(object.from, child(path, "from"), issues);
      validateEndpoint(object.to, child(path, "to"), issues);
      validateRouting(object.routing, child(path, "routing"), issues);
      optional(object, "waypoints", path, issues, (entry, entryPath, list) => arrayValue(entry, entryPath, list, validateVec2));
      validateStroke(object.stroke, child(path, "stroke"), issues);
      optional(object, "startMarker", path, issues, validateMarker);
      optional(object, "endMarker", path, issues, validateMarker);
      optional(object, "avoidNodeIds", path, issues, (entry, entryPath, list) => arrayValue(entry, entryPath, list, (id, idPath, idIssues) => { stringValue(id, idPath, idIssues, { nonEmpty: true }); }));
      optional(object, "labelNodeId", path, issues, (entry, entryPath, list) => { stringValue(entry, entryPath, list, { nonEmpty: true }); });
      break;
    case "widget-frame":
      validateSize(object.size, child(path, "size"), issues);
      optional(object, "title", path, issues, stringValue);
      optional(object, "titleBarColor", path, issues, validateColor);
      optional(object, "headerItems", path, issues, (entry, entryPath, list) => arrayValue(entry, entryPath, list, validateWidgetHeaderItem));
      optional(object, "collapsed", path, issues, booleanValue);
      optional(object, "resizable", path, issues, booleanValue);
      optional(object, "minSize", path, issues, validateSize);
      optional(object, "maxSize", path, issues, validateSize);
      break;
    case "text":
      arrayValue(object.runs, child(path, "runs"), issues, (entry, entryPath, list) => {
        const run = record(entry, entryPath, list, ["text", "style", "metadata"]);
        if (run) {
          stringValue(run.text, child(entryPath, "text"), list);
          optional(run, "style", entryPath, list, (style, stylePath, styleIssues) => validateTextStyle(style, stylePath, styleIssues, true));
          optional(run, "metadata", entryPath, list, validateJsonObject);
        }
      }, { min: 1 });
      validateTextStyle(object.style, child(path, "style"), issues);
      validateTextLayout(object.layout, child(path, "layout"), issues);
      optional(object, "align", path, issues, (entry, entryPath, list) => enumValue(entry, entryPath, list, ["left", "center", "right", "justify"]));
      optional(object, "verticalAlign", path, issues, (entry, entryPath, list) => enumValue(entry, entryPath, list, ["top", "middle", "bottom"]));
      optional(object, "direction", path, issues, (entry, entryPath, list) => enumValue(entry, entryPath, list, ["auto", "ltr", "rtl"]));
      optional(object, "wrap", path, issues, (entry, entryPath, list) => enumValue(entry, entryPath, list, ["word", "character", "none"]));
      optional(object, "selectable", path, issues, booleanValue);
      break;
  }
  validateExtensions(object as unknown as TCanvasSceneNode, path, issues);
  return true;
}

function solidPaint(value: unknown): boolean {
  return isPlainRecord(value) && value.type === "solid" && isPlainRecord(value.color);
}

function validateWidgetExtension(node: TCanvasSceneNode, value: unknown, path: string, issues: Issues): void {
  if (node.kind !== "widget-frame") {
    add(issues, "WIDGET_EXTENSION_NODE_KIND", path, "Widget extensions are allowed only on widget-frame nodes.", node.id);
    return;
  }
  if (!isPlainRecord(value)) {
    add(issues, "INVALID_WIDGET_EXTENSION", path, "Widget extension must be an object.", node.id);
    return;
  }
  const ui = value.type === "ui-widget";
  const instance = value.type === "widget-instance" || value.type === "widget-preview";
  const object = record(value, path, issues, ui
    ? ["schemaVersion", "type", "kind", "payload", "uiProps"]
    : ["schemaVersion", "type", "instanceId", "widgetKey", "uiProps"]);
  if (!object) return;
  if (object.schemaVersion !== 1) add(issues, "WIDGET_EXTENSION_VERSION", child(path, "schemaVersion"), "Widget extension schemaVersion must be 1.", node.id);
  if (ui) {
    if (!stringValue(object.kind, child(path, "kind"), issues, { nonEmpty: true })) return;
  } else if (instance) {
    const instanceId = object.instanceId;
    const instanceIdValid = stringValue(instanceId, child(path, "instanceId"), issues, { nonEmpty: true, max: 200 });
    if (instanceIdValid && instanceId.trim() !== instanceId) {
      add(issues, "WIDGET_EXTENSION_IDENTITY", child(path, "instanceId"), "instanceId must be trimmed.", node.id);
    }
    const widgetKey = object.widgetKey;
    const keyValid = stringValue(widgetKey, child(path, "widgetKey"), issues, { nonEmpty: true, max: 100 });
    if (keyValid && !WIDGET_KEY.test(widgetKey)) {
      add(issues, "WIDGET_EXTENSION_WIDGET_KEY", child(path, "widgetKey"), "widgetKey must be lowercase ASCII kebab-case.", node.id);
    }
  } else {
    add(issues, "WIDGET_EXTENSION_TYPE", child(path, "type"), "Unsupported widget extension type.", node.id);
  }
}

function validateAuthoringExtension(node: TCanvasSceneNode, value: unknown, path: string, issues: Issues): void {
  const object = record(value, path, issues, ["schemaVersion", "locked", "penSource"]);
  if (!object) {
    add(issues, "INVALID_AUTHORING_EXTENSION", path, "Authoring extension must be an object.", node.id);
    return;
  }
  if (object.schemaVersion !== 1) add(issues, "AUTHORING_EXTENSION_VERSION", child(path, "schemaVersion"), "Authoring extension schemaVersion must be 1.", node.id);
  optional(object, "locked", path, issues, booleanValue);
  if (has(object, "penSource")) {
    const penPath = child(path, "penSource");
    const pen = record(object.penSource, penPath, issues, ["points", "pressures", "simulatePressure"]);
    if (pen) {
      const pointsValue = pen.points;
      const pressuresValue = pen.pressures;
      const points = arrayValue(pointsValue, child(penPath, "points"), issues, validateVec2);
      const pressures = arrayValue(pressuresValue, child(penPath, "pressures"), issues, (entry, entryPath, list) => { numberValue(entry, entryPath, list, { min: 0, max: 1 }); });
      booleanValue(pen.simulatePressure, child(penPath, "simulatePressure"), issues);
      if (points && pressures && pointsValue.length !== pressuresValue.length) {
        add(issues, "AUTHORING_EXTENSION_PEN_LENGTH", penPath, "penSource points and pressures must have equal lengths.", node.id);
      }
    }
  }
}

function validateImageExtension(node: TCanvasSceneNode, value: unknown, path: string, issues: Issues): void {
  if (node.kind !== "image") {
    add(issues, "IMAGE_EXTENSION_NODE_KIND", path, "Image extensions are allowed only on image nodes.", node.id);
    return;
  }
  const object = record(value, path, issues, ["schemaVersion", "url", "mimeType"]);
  if (!object) {
    add(issues, "INVALID_IMAGE_EXTENSION", path, "Image extension must be an object.", node.id);
    return;
  }
  if (object.schemaVersion !== 1) add(issues, "IMAGE_EXTENSION_VERSION", child(path, "schemaVersion"), "Image extension schemaVersion must be 1.", node.id);
  stringValue(object.url, child(path, "url"), issues, { nonEmpty: true });
  if (!enumValue(object.mimeType, child(path, "mimeType"), issues, ["image/jpeg", "image/png", "image/gif", "image/webp"])) {
    add(issues, "IMAGE_EXTENSION_MIME_TYPE", child(path, "mimeType"), "Unsupported image MIME type.", node.id);
  }
}

function validateSemanticExtension(node: TCanvasSceneNode, value: unknown, path: string, issues: Issues): void {
  const object = record(value, path, issues, ["schemaVersion", "background", "ink"]);
  if (!object) {
    add(issues, "INVALID_SEMANTIC_STYLE_EXTENSION", path, "Semantic style extension must be an object.", node.id);
    return;
  }
  if (object.schemaVersion !== 1) add(issues, "SEMANTIC_STYLE_EXTENSION_VERSION", child(path, "schemaVersion"), "Semantic style schemaVersion must be 1.", node.id);
  if (!has(object, "background") && !has(object, "ink")) add(issues, "SEMANTIC_STYLE_EXTENSION_EMPTY", path, "Semantic style must contain background or ink intent.", node.id);
  if (has(object, "background")) {
    if (typeof object.background !== "string" || !FILL_CODES.has(object.background)) add(issues, "SEMANTIC_STYLE_BACKGROUND_CODE", child(path, "background"), "Unsupported semantic background code.", node.id);
    if (!BACKGROUND_STYLE_KINDS.has(node.kind)) add(issues, "SEMANTIC_STYLE_BACKGROUND_NODE_KIND", child(path, "background"), "This node kind cannot carry background intent.", node.id);
    else {
      const fallback = node.kind === "widget-frame"
        ? node.titleBarColor !== undefined
        : "fill" in node && solidPaint(node.fill);
      if (!fallback) add(issues, "SEMANTIC_STYLE_BACKGROUND_FALLBACK", path, "Semantic background intent requires a concrete solid paint fallback.", node.id);
    }
  }
  if (has(object, "ink")) {
    if (typeof object.ink !== "string" || !INK_CODES.has(object.ink)) add(issues, "SEMANTIC_STYLE_INK_CODE", child(path, "ink"), "Unsupported semantic ink code.", node.id);
    if (!INK_STYLE_KINDS.has(node.kind)) add(issues, "SEMANTIC_STYLE_INK_NODE_KIND", child(path, "ink"), "This node kind cannot carry ink intent.", node.id);
    else {
      const fallback = node.kind === "text"
        ? solidPaint(node.style.fill)
        : node.kind === "path" && node.stroke === undefined
          ? solidPaint(node.fill)
          : "stroke" in node && node.stroke !== undefined && solidPaint(node.stroke.paint);
      if (!fallback) add(issues, "SEMANTIC_STYLE_INK_FALLBACK", path, "Semantic ink intent requires a concrete solid paint fallback.", node.id);
    }
  }
}

function validateExtensions(node: TCanvasSceneNode, path: string, issues: Issues): void {
  const extensions = node.extensions;
  const extensionsPath = child(path, "extensions");
  if (node.kind === "image" && extensions?.[CANVAS_IMAGE_EXTENSION_KEY] === undefined) {
    add(issues, "IMAGE_EXTENSION_REQUIRED", child(extensionsPath, CANVAS_IMAGE_EXTENSION_KEY), "Persisted image nodes require a durable image descriptor.", node.id);
  }
  if (!extensions) return;
  const widget = extensions[CANVAS_WIDGET_EXTENSION_KEY];
  if (widget !== undefined) validateWidgetExtension(node, widget, child(extensionsPath, CANVAS_WIDGET_EXTENSION_KEY), issues);
  const authoring = extensions[CANVAS_AUTHORING_EXTENSION_KEY];
  if (authoring !== undefined) validateAuthoringExtension(node, authoring, child(extensionsPath, CANVAS_AUTHORING_EXTENSION_KEY), issues);
  const image = extensions[CANVAS_IMAGE_EXTENSION_KEY];
  if (image !== undefined) validateImageExtension(node, image, child(extensionsPath, CANVAS_IMAGE_EXTENSION_KEY), issues);
  const semantic = extensions[CANVAS_SEMANTIC_STYLE_EXTENSION_KEY];
  if (semantic !== undefined) validateSemanticExtension(node, semantic, child(extensionsPath, CANVAS_SEMANTIC_STYLE_EXTENSION_KEY), issues);
}

function validateNodeArray(value: unknown, path: string, issues: Issues): value is TCanvasSceneNode[] {
  if (!Array.isArray(value)) {
    add(issues, "INVALID_ARRAY", path, "Canvas items must be an array.");
    return false;
  }
  const nodes: TCanvasSceneNode[] = [];
  value.forEach((entry, index) => {
    const before = issues.length;
    if (validateNode(entry, child(path, index), issues) && issues.length === before) nodes.push(entry);
  });
  if (nodes.length !== value.length) return false;

  const byId = new Map<string, { node: TCanvasSceneNode; index: number }>();
  const imageDescriptors = new Map<string, { url: string; mimeType: string }>();
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    const existing = byId.get(node.id);
    if (existing) add(issues, "DUPLICATE_ITEM_ID", child(child(path, index), "id"), `Item ID '${node.id}' is duplicated.`, node.id);
    else byId.set(node.id, { node, index });
    if (node.id.startsWith("omnidraw:runtime:")) add(issues, "RESERVED_ITEM_ID", child(child(path, index), "id"), "Runtime-owned item IDs cannot be persisted.", node.id);
    if (node.kind === "image") {
      const descriptor = fnReadCanvasImageExtension(node);
      const prior = imageDescriptors.get(node.resourceId);
      if (descriptor && prior && (prior.url !== descriptor.url || prior.mimeType !== descriptor.mimeType)) {
        add(issues, "IMAGE_RESOURCE_DESCRIPTOR_CONFLICT", child(child(child(path, index), "extensions"), CANVAS_IMAGE_EXTENSION_KEY), `Image resource '${node.resourceId}' has conflicting descriptors.`, node.id);
      } else if (descriptor && !prior) imageDescriptors.set(node.resourceId, descriptor);
    }
  }
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.parentId !== null && !byId.has(node.parentId)) add(issues, "PARENT_NOT_FOUND", child(child(path, index), "parentId"), `Parent '${node.parentId}' does not exist.`, node.id);
    const references: Array<[string, string]> = [];
    if (node.clip?.type === "node") references.push([node.clip.nodeId, "clip/nodeId"]);
    if (node.kind === "connector") {
      if (node.from.type === "node") references.push([node.from.nodeId, "from/nodeId"]);
      if (node.to.type === "node") references.push([node.to.nodeId, "to/nodeId"]);
      for (let refIndex = 0; refIndex < (node.avoidNodeIds?.length ?? 0); refIndex += 1) references.push([node.avoidNodeIds![refIndex]!, `avoidNodeIds/${refIndex}`]);
      if (node.labelNodeId !== undefined) references.push([node.labelNodeId, "labelNodeId"]);
    }
    for (const [id, referencePath] of references) {
      if (!byId.has(id)) add(issues, "NODE_REFERENCE_NOT_FOUND", `${child(path, index)}/${referencePath}`, `Referenced node '${id}' does not exist.`, node.id);
    }
  }
  const reported = new Set<string>();
  for (let index = 0; index < nodes.length; index += 1) {
    const origin = nodes[index]!;
    const chain = new Set<string>();
    let current: TCanvasSceneNode | undefined = origin;
    while (current !== undefined && current.parentId !== null) {
      if (chain.has(current.id)) {
        if (!reported.has(origin.id)) {
          add(issues, "HIERARCHY_CYCLE", child(child(path, index), "parentId"), "Canvas item hierarchy contains a cycle.", origin.id);
          reported.add(origin.id);
        }
        break;
      }
      chain.add(current.id);
      current = byId.get(current.parentId)?.node;
    }
  }
  return true;
}

function validateItemSnapshot(value: unknown, path: string, issues: Issues): value is TCanvasItemSnapshot {
  const object = record(value, path, issues, ["id", "item", "itemRevision", "createdAtSec", "updatedAtSec"]);
  if (!object) return false;
  const id = object.id;
  const item = object.item;
  const idValid = stringValue(id, child(path, "id"), issues, { nonEmpty: true });
  const nodeValid = validateNode(item, child(path, "item"), issues);
  numberValue(object.itemRevision, child(path, "itemRevision"), issues, { min: 1, integer: true });
  stringValue(object.createdAtSec, child(path, "createdAtSec"), issues, { pattern: TIMESTAMP_SEC });
  stringValue(object.updatedAtSec, child(path, "updatedAtSec"), issues, { pattern: TIMESTAMP_SEC });
  if (idValid && nodeValid && id !== item.id) add(issues, "ITEM_ID_MISMATCH", child(path, "id"), "Snapshot id must equal item.id.", id);
  return true;
}

function validateJsonPath(value: unknown, path: string, issues: Issues): void {
  arrayValue(value, path, issues, (entry, entryPath, list) => {
    if (typeof entry === "string") {
      if (entry.length === 0) add(list, "INVALID_JSON_PATH", entryPath, "String path segments cannot be empty.");
    } else {
      numberValue(entry, entryPath, list, { min: 0, integer: true });
    }
  });
}

function validateOperation(value: unknown, path: string, issues: Issues): void {
  if (!isPlainRecord(value)) {
    add(issues, "INVALID_OPERATION", path, "Operation must be an object.");
    return;
  }
  if (value.type === "insert" || value.type === "replace") {
    const object = record(value, path, issues, ["type", "item"]);
    if (object) validateNode(object.item, child(path, "item"), issues);
  } else if (value.type === "patch") {
    const object = record(value, path, issues, ["type", "itemId", "patches"]);
    if (object) {
      stringValue(object.itemId, child(path, "itemId"), issues, { nonEmpty: true });
      arrayValue(object.patches, child(path, "patches"), issues, validatePatch, { min: 1, max: CANVAS_COMMAND_MAX_OPERATIONS });
    }
  } else if (value.type === "delete") {
    const object = record(value, path, issues, ["type", "itemId"]);
    if (object) stringValue(object.itemId, child(path, "itemId"), issues, { nonEmpty: true });
  } else if (value.type === "reparent") {
    const object = record(value, path, issues, ["type", "itemId", "parentId", "orderKey"]);
    if (object) {
      stringValue(object.itemId, child(path, "itemId"), issues, { nonEmpty: true });
      if (object.parentId !== null) stringValue(object.parentId, child(path, "parentId"), issues, { nonEmpty: true });
      optional(object, "orderKey", path, issues, (entry, entryPath, list) => { stringValue(entry, entryPath, list, { nonEmpty: true }); });
    }
  } else if (value.type === "reorder") {
    const object = record(value, path, issues, ["type", "itemId", "orderKey"]);
    if (object) {
      stringValue(object.itemId, child(path, "itemId"), issues, { nonEmpty: true });
      stringValue(object.orderKey, child(path, "orderKey"), issues, { nonEmpty: true });
    }
  } else {
    add(issues, "INVALID_OPERATION", child(path, "type"), "Unsupported Canvas operation type.");
  }
}

function validatePatch(value: unknown, path: string, issues: Issues): void {
  if (!isPlainRecord(value)) {
    add(issues, "INVALID_PATCH", path, "Patch must be an object.");
  } else if (value.type === "set") {
    const object = record(value, path, issues, ["type", "path", "value"]);
    if (object) validateJsonPath(object.path, child(path, "path"), issues);
  } else if (value.type === "remove") {
    const object = record(value, path, issues, ["type", "path"]);
    if (object) validateJsonPath(object.path, child(path, "path"), issues);
  } else {
    add(issues, "INVALID_PATCH", child(path, "type"), "Unsupported Canvas patch type.");
  }
}

function validatePrecondition(value: unknown, path: string, issues: Issues): void {
  if (!isPlainRecord(value)) {
    add(issues, "INVALID_PRECONDITION", path, "Precondition must be an object.");
    return;
  }
  if (value.type === "item-absent") {
    const object = record(value, path, issues, ["type", "itemId"]);
    if (object) stringValue(object.itemId, child(path, "itemId"), issues, { nonEmpty: true });
  } else if (value.type === "item-revision") {
    const object = record(value, path, issues, ["type", "itemId", "itemRevision"]);
    if (object) {
      stringValue(object.itemId, child(path, "itemId"), issues, { nonEmpty: true });
      numberValue(object.itemRevision, child(path, "itemRevision"), issues, { min: 1, integer: true });
    }
  } else if (value.type === "path-absent" || value.type === "path-value") {
    const object = record(value, path, issues, value.type === "path-value" ? ["type", "itemId", "path", "value"] : ["type", "itemId", "path"]);
    if (object) {
      stringValue(object.itemId, child(path, "itemId"), issues, { nonEmpty: true });
      validateJsonPath(object.path, child(path, "path"), issues);
    }
  } else {
    add(issues, "INVALID_PRECONDITION", child(path, "type"), "Unsupported precondition type.");
  }
}

function validateCursor(value: unknown, path: string, issues: Issues): void {
  if (!isPlainRecord(value)) {
    add(issues, "INVALID_QUERY_CURSOR", path, "Query cursor must be an object.");
  } else if (value.type === "id") {
    const object = record(value, path, issues, ["type", "id"]);
    if (object) stringValue(object.id, child(path, "id"), issues, { nonEmpty: true });
  } else if (value.type === "parent-order") {
    const object = record(value, path, issues, ["type", "orderKey", "id"]);
    if (object) {
      stringValue(object.orderKey, child(path, "orderKey"), issues, { nonEmpty: true });
      stringValue(object.id, child(path, "id"), issues, { nonEmpty: true });
    }
  } else if (value.type === "widget-identity") {
    const object = record(value, path, issues, ["type", "instanceId", "id"]);
    if (object) {
      stringValue(object.instanceId, child(path, "instanceId"), issues, { nonEmpty: true });
      stringValue(object.id, child(path, "id"), issues, { nonEmpty: true });
    }
  } else add(issues, "INVALID_QUERY_CURSOR", child(path, "type"), "Unsupported query cursor type.");
}

function validateFilter(value: unknown, path: string, issues: Issues): string | null {
  if (!isPlainRecord(value)) {
    add(issues, "INVALID_QUERY_FILTER", path, "Query filter must be an object.");
    return null;
  }
  if (value.type === "all") record(value, path, issues, ["type"]);
  else if (value.type === "ids") {
    const object = record(value, path, issues, ["type", "ids"]);
    if (object) arrayValue(object.ids, child(path, "ids"), issues, (entry, entryPath, list) => { stringValue(entry, entryPath, list, { nonEmpty: true }); }, { min: 1, max: CANVAS_QUERY_MAX_LIMIT });
  } else if (value.type === "kind") {
    const object = record(value, path, issues, ["type", "kind"]);
    if (object && (typeof object.kind !== "string" || !AUTHORED_KINDS.has(object.kind))) add(issues, "INVALID_NODE_KIND", child(path, "kind"), "Unsupported authored node kind.");
  } else if (value.type === "parent") {
    const object = record(value, path, issues, ["type", "parentId"]);
    if (object && object.parentId !== null) stringValue(object.parentId, child(path, "parentId"), issues, { nonEmpty: true });
  } else if (value.type === "widget-instance") {
    const object = record(value, path, issues, ["type", "instanceId"]);
    if (object) stringValue(object.instanceId, child(path, "instanceId"), issues, { nonEmpty: true, max: 200 });
  } else if (value.type === "widget-key") {
    const object = record(value, path, issues, ["type", "widgetKey"]);
    if (object && stringValue(object.widgetKey, child(path, "widgetKey"), issues, { nonEmpty: true, max: 100 }) && !WIDGET_KEY.test(object.widgetKey)) add(issues, "WIDGET_EXTENSION_WIDGET_KEY", child(path, "widgetKey"), "widgetKey must be lowercase ASCII kebab-case.");
  } else {
    add(issues, "INVALID_QUERY_FILTER", child(path, "type"), "Unsupported query filter type.");
    return null;
  }
  return String(value.type);
}

function finish(issues: Issues): TCanvasContractValidation {
  return { valid: issues.length === 0, issues };
}

function validateRoot(value: unknown, structural: (value: unknown, issues: Issues) => void): TCanvasContractValidation {
  const issues: Issues = [];
  preflight(value, "", issues);
  if (issues.length === 0) structural(value, issues);
  return finish(issues);
}

export function fnValidateCanvasSceneNode(value: unknown): TCanvasContractValidation {
  return validateRoot(value, (entry, issues) => { validateNode(entry, "", issues); });
}

export function fnValidateCanvasItems(value: unknown): TCanvasContractValidation {
  return validateRoot(value, (entry, issues) => { validateNodeArray(entry, "/items", issues); });
}

export function fnValidateCanvasItemExtensions(node: TCanvasSceneNode): TCanvasContractValidation {
  return validateRoot(node.extensions ?? {}, (_entry, issues) => { validateExtensions(node, "", issues); });
}

export function fnValidateCanvasDocument(value: unknown): TCanvasContractValidation {
  return validateRoot(value, (entry, issues) => {
    const object = record(entry, "", issues, ["schemaVersion", "canvasId", "revision", "items"]);
    if (!object) return;
    if (object.schemaVersion !== CANVAS_SCENE_SCHEMA_VERSION) add(issues, "UNSUPPORTED_SCHEMA_VERSION", "/schemaVersion", `schemaVersion must be '${CANVAS_SCENE_SCHEMA_VERSION}'.`);
    stringValue(object.canvasId, "/canvasId", issues, { nonEmpty: true, max: 200 });
    numberValue(object.revision, "/revision", issues, { min: 0, integer: true });
    if (!Array.isArray(object.items)) {
      add(issues, "INVALID_ARRAY", "/items", "Document items must be an array.");
      return;
    }
    const nodes: unknown[] = [];
    object.items.forEach((item, index) => {
      validateItemSnapshot(item, `/items/${index}`, issues);
      if (isPlainRecord(item)) nodes.push(item.item);
    });
    validateNodeArray(nodes, "/items-by-node", issues);
  });
}

export function fnValidateCanvasCommand(value: unknown): TCanvasContractValidation {
  return validateRoot(value, (entry, issues) => {
    const object = record(entry, "", issues, ["commandId", "canvasId", "baseRevision", "operations", "preconditions"]);
    if (!object) return;
    stringValue(object.commandId, "/commandId", issues, { nonEmpty: true, max: 200 });
    stringValue(object.canvasId, "/canvasId", issues, { nonEmpty: true, max: 200 });
    numberValue(object.baseRevision, "/baseRevision", issues, { min: 0, integer: true });
    arrayValue(object.operations, "/operations", issues, validateOperation, { min: 1, max: CANVAS_COMMAND_MAX_OPERATIONS });
    arrayValue(object.preconditions, "/preconditions", issues, validatePrecondition, { max: CANVAS_COMMAND_MAX_OPERATIONS });
  });
}

export function fnValidateCanvasQuery(value: unknown): TCanvasContractValidation {
  return validateRoot(value, (entry, issues) => {
    const object = record(entry, "", issues, ["canvasId", "filter", "limit", "cursor"]);
    if (!object) return;
    stringValue(object.canvasId, "/canvasId", issues, { nonEmpty: true, max: 200 });
    const filterType = validateFilter(object.filter, "/filter", issues);
    optional(object, "limit", "", issues, (limit, limitPath, list) => numberValue(limit, limitPath, list, { min: 1, max: CANVAS_QUERY_MAX_LIMIT, integer: true }));
    if (has(object, "cursor")) {
      validateCursor(object.cursor, "/cursor", issues);
      if (isPlainRecord(object.cursor)) {
        const allowed = filterType === "parent" ? "parent-order"
          : filterType === "widget-key" ? "widget-identity"
            : filterType === "widget-instance" ? null : "id";
        if (allowed === null || object.cursor.type !== allowed) add(issues, "QUERY_CURSOR_FILTER_MISMATCH", "/cursor/type", "Cursor type is incompatible with the query filter.");
      }
    }
  });
}

export function fnValidateCanvasItemPage(value: unknown): TCanvasContractValidation {
  return validateRoot(value, (entry, issues) => {
    const object = record(entry, "", issues, ["items", "nextCursor"]);
    if (!object) return;
    if (Array.isArray(object.items)) object.items.forEach((item, index) => validateItemSnapshot(item, `/items/${index}`, issues));
    else add(issues, "INVALID_ARRAY", "/items", "Page items must be an array.");
    if (object.nextCursor !== null) validateCursor(object.nextCursor, "/nextCursor", issues);
  });
}

export function fnValidateCanvasEvent(value: unknown): TCanvasContractValidation {
  return validateRoot(value, (entry, issues) => {
    if (!isPlainRecord(entry)) {
      add(issues, "INVALID_EVENT", "", "Canvas event must be an object.");
    } else if (entry.type === "resync-required") {
      const object = record(entry, "", issues, ["type", "canvasId", "revision"]);
      if (object) {
        stringValue(object.canvasId, "/canvasId", issues, { nonEmpty: true });
        numberValue(object.revision, "/revision", issues, { min: 0, integer: true });
      }
    } else if (entry.type === "items-changed") {
      const object = record(entry, "", issues, ["type", "canvasId", "commandId", "revision", "changedItems", "deletedItemIds"]);
      if (object) {
        stringValue(object.canvasId, "/canvasId", issues, { nonEmpty: true });
        stringValue(object.commandId, "/commandId", issues, { nonEmpty: true });
        numberValue(object.revision, "/revision", issues, { min: 0, integer: true });
        if (Array.isArray(object.changedItems)) object.changedItems.forEach((item, index) => validateItemSnapshot(item, `/changedItems/${index}`, issues));
        else add(issues, "INVALID_ARRAY", "/changedItems", "changedItems must be an array.");
        arrayValue(object.deletedItemIds, "/deletedItemIds", issues, (id, idPath, list) => { stringValue(id, idPath, list, { nonEmpty: true }); });
      }
    } else add(issues, "INVALID_EVENT", "/type", "Unsupported Canvas event type.");
  });
}

function assertValid<A>(
  value: unknown,
  validation: TCanvasContractValidation,
  label: string,
): asserts value is A {
  if (validation.valid) return;
  const summary = validation.issues.map((entry) => `${entry.code} at ${entry.path || "/"}: ${entry.message}`).join("\n");
  throw new TypeError(`Invalid ${label}:\n${summary}`);
}

export function fnAssertValidCanvasSceneNode(value: unknown): asserts value is TCanvasSceneNode {
  assertValid<TCanvasSceneNode>(value, fnValidateCanvasSceneNode(value), "Canvas scene node");
}

export function fnAssertValidCanvasItems(value: unknown): asserts value is readonly TCanvasSceneNode[] {
  assertValid<readonly TCanvasSceneNode[]>(value, fnValidateCanvasItems(value), "Canvas items");
}

export function fnAssertValidCanvasDocument(value: unknown): asserts value is TCanvasDocument {
  assertValid<TCanvasDocument>(value, fnValidateCanvasDocument(value), "Canvas document");
}

export function fnAssertValidCanvasCommand(value: unknown): asserts value is TCanvasCommand {
  assertValid<TCanvasCommand>(value, fnValidateCanvasCommand(value), "Canvas command");
}

export function fnAssertValidCanvasQuery(value: unknown): asserts value is TCanvasItemQuery {
  assertValid<TCanvasItemQuery>(value, fnValidateCanvasQuery(value), "Canvas query");
}

export function fnAssertValidCanvasItemPage(value: unknown): asserts value is TCanvasItemPage {
  assertValid<TCanvasItemPage>(value, fnValidateCanvasItemPage(value), "Canvas item page");
}

export function fnAssertValidCanvasEvent(value: unknown): asserts value is TCanvasEvent {
  assertValid<TCanvasEvent>(value, fnValidateCanvasEvent(value), "Canvas event");
}

export function fnReadCanvasWidgetExtension(node: TCanvasSceneNode): TCanvasWidgetExtensionV1 | null {
  const value = node.extensions?.[CANVAS_WIDGET_EXTENSION_KEY];
  if (value === undefined) return null;
  const issues: Issues = [];
  validateWidgetExtension(node, value, `/extensions/${CANVAS_WIDGET_EXTENSION_KEY}`, issues);
  return issues.length === 0 ? value as TCanvasWidgetExtensionV1 : null;
}

export function fnReadCanvasAuthoringExtension(node: TCanvasSceneNode): TCanvasAuthoringExtensionV1 | null {
  const value = node.extensions?.[CANVAS_AUTHORING_EXTENSION_KEY];
  if (value === undefined) return null;
  const issues: Issues = [];
  validateAuthoringExtension(node, value, `/extensions/${CANVAS_AUTHORING_EXTENSION_KEY}`, issues);
  return issues.length === 0 ? value as unknown as TCanvasAuthoringExtensionV1 : null;
}

export function fnReadCanvasImageExtension(node: TCanvasSceneNode): TCanvasImageExtensionV1 | null {
  const value = node.extensions?.[CANVAS_IMAGE_EXTENSION_KEY];
  if (value === undefined) return null;
  const issues: Issues = [];
  validateImageExtension(node, value, `/extensions/${CANVAS_IMAGE_EXTENSION_KEY}`, issues);
  return issues.length === 0 ? value as unknown as TCanvasImageExtensionV1 : null;
}

export function fnReadCanvasSemanticStyleExtension(node: TCanvasSceneNode): TCanvasSemanticStyleExtensionV1 | null {
  const value = node.extensions?.[CANVAS_SEMANTIC_STYLE_EXTENSION_KEY];
  if (value === undefined) return null;
  const issues: Issues = [];
  validateSemanticExtension(node, value, `/extensions/${CANVAS_SEMANTIC_STYLE_EXTENSION_KEY}`, issues);
  return issues.length === 0 ? value as unknown as TCanvasSemanticStyleExtensionV1 : null;
}
