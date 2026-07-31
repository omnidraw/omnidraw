import { ZOmnidrawToolIcon } from "@omnidraw/widget-contract";
import { z } from "zod";

export const ZToolGroupJson = ZOmnidrawToolIcon.nullable();

export const ZToolGroup = z.object({
  name: z.string().trim().min(1),
  json: ZToolGroupJson,
});

export const ZToolGroupNameInput = z.object({
  name: z.string().trim().min(1),
});

export const ZToolGroupUpdateInput = z.object({
  currentName: z.string().trim().min(1),
  group: ZToolGroup,
});

export type TToolGroup = z.infer<typeof ZToolGroup>;
