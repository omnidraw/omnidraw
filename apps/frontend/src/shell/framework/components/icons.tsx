/**
 * Solid 2-native Lucide icons generated from the pinned lucide-static 1.24.0
 * SVG assets. The source artwork and this bounded adaptation use the ISC
 * license shipped with lucide-static.
 */
import type { JSX } from "@solidjs/web";
import { omit, type Component, type Element } from "solid-js";

export type TLucideIconProps = JSX.SvgSVGAttributes<SVGSVGElement> & Readonly<{
  absoluteStrokeWidth?: boolean;
  color?: string;
  size?: number | string;
  strokeWidth?: number | string;
}>;

function hasAccessibleName(props: JSX.SvgSVGAttributes<SVGSVGElement>): boolean {
  return Object.keys(props).some((key) => key.startsWith("aria-") || key === "role" || key === "title");
}

function createLucideIcon(name: string, nodes: () => Element): Component<TLucideIconProps> {
  return (props) => {
    const rest = omit(props, "absoluteStrokeWidth", "class", "color", "size", "strokeWidth");
    return (
      <svg
        {...rest}
        xmlns="http://www.w3.org/2000/svg"
        width={props.size ?? 24}
        height={props.size ?? 24}
        viewBox="0 0 24 24"
        fill="none"
        stroke={props.color ?? "currentColor"}
        stroke-width={props.absoluteStrokeWidth === true
          ? Number(props.strokeWidth ?? 2) * 24 / Number(props.size ?? 24)
          : props.strokeWidth ?? 2}
        stroke-linecap="round"
        stroke-linejoin="round"
        class={["lucide", "lucide-icon", `lucide-${name}`, props.class]}
        aria-hidden={hasAccessibleName(rest) ? undefined : "true"}
      >
        {nodes()}
      </svg>
    );
  };
}

export const Bot = createLucideIcon("bot", () => <>
  <path d="M12 8V4H8" />
  <rect width="16" height="12" x="4" y="8" rx="2" />
  <path d="M2 14h2" />
  <path d="M20 14h2" />
  <path d="M15 13v2" />
  <path d="M9 13v2" />
</>);

export const PanelLeft = createLucideIcon("panel-left", () => <>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M9 3v18" />
</>);

export const X = createLucideIcon("x", () => <>
  <path d="M18 6 6 18" />
  <path d="m6 6 12 12" />
</>);

export const ChevronDown = createLucideIcon("chevron-down", () => <path d="m6 9 6 6 6-6" />);

export const Database = createLucideIcon("database", () => <>
  <ellipse cx="12" cy="5" rx="9" ry="3" />
  <path d="M3 5V19A9 3 0 0 0 21 19V5" />
  <path d="M3 12A9 3 0 0 0 21 12" />
</>);

export const MoreHorizontal = createLucideIcon("more-horizontal", () => <>
  <circle cx="12" cy="12" r="1" />
  <circle cx="19" cy="12" r="1" />
  <circle cx="5" cy="12" r="1" />
</>);

export const Plus = createLucideIcon("plus", () => <>
  <path d="M5 12h14" />
  <path d="M12 5v14" />
</>);

export const RefreshCw = createLucideIcon("refresh-cw", () => <>
  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
  <path d="M21 3v5h-5" />
  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
  <path d="M8 16H3v5" />
</>);

export const Trash2 = createLucideIcon("trash-2", () => <>
  <path d="M10 11v6" />
  <path d="M14 11v6" />
  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  <path d="M3 6h18" />
  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
</>);

export const Check = createLucideIcon("check", () => <path d="M20 6 9 17l-5-5" />);

export const MoonStar = createLucideIcon("moon-star", () => <>
  <path d="M18 5h4" />
  <path d="M20 3v4" />
  <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
</>);

export const Sun = createLucideIcon("sun", () => <>
  <circle cx="12" cy="12" r="4" />
  <path d="M12 2v2" />
  <path d="M12 20v2" />
  <path d="m4.93 4.93 1.41 1.41" />
  <path d="m17.66 17.66 1.41 1.41" />
  <path d="M2 12h2" />
  <path d="M20 12h2" />
  <path d="m6.34 17.66-1.41 1.41" />
  <path d="m19.07 4.93-1.41 1.41" />
</>);

export const Pencil = createLucideIcon("pencil", () => <>
  <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
  <path d="m15 5 4 4" />
</>);

export const File = createLucideIcon("file", () => <>
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
</>);

export const Folder = createLucideIcon("folder", () => (
  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
));

export const Puzzle = createLucideIcon("puzzle", () => (
  <path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z" />
));

export const ChevronRight = createLucideIcon("chevron-right", () => <path d="m9 18 6-6-6-6" />);

export const TriangleAlert = createLucideIcon("triangle-alert", () => <>
  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
  <path d="M12 9v4" />
  <path d="M12 17h.01" />
</>);
