import type { TImageUploadFormat } from "../types";

export const SUPPORTED_IMAGE_FORMATS = new Set<TImageUploadFormat>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export const VC_Z_INDEX_ATTR = "vcZIndex";
export const VC_NODE_KIND_ATTR = "vcNodeKind";
export const VC_CREATED_AT_ATTR = "vcCreatedAt";
export const VC_UPDATED_AT_ATTR = "vcUpdatedAt";
export const VC_ON_REMOVE_ATTR = "onRemove";
export const ELEMENT_STYLE_ATTR = "vcElementStyle";
export const ELEMENT_DATA_ATTR = "vcElementData";
