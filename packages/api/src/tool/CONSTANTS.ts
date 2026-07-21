import { ZVibecanvasToolIcon } from "@vibecanvas/service-actor/core/vibecanvasjson.zod";
import { z } from "zod";

export const ZToolGroupJson = ZVibecanvasToolIcon.nullable();

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
