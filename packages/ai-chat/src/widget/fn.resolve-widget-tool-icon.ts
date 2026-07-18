import type { TVibecanvasToolIcon } from "@vibecanvas/service-actor/core/tool-icon";
import { LUCIDE_STATIC_ICON_BY_KEY } from "./CONSTANTS";

export function fnResolveWidgetToolIcon(icon: TVibecanvasToolIcon | undefined) {
  const svgIcon = icon?.svgIcon?.trim();
  if (svgIcon) {
    return svgIcon;
  }

  const lucidIcon = icon?.lucidIcon;
  if (!lucidIcon) {
    return undefined;
  }

  return LUCIDE_STATIC_ICON_BY_KEY[lucidIcon];
}
