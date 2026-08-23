/**
 * @license Lucide Icons v1.24.0 - ISC
 *
 * Static icon paths are sourced from the installed lucide-static package.
 * See the package LICENSE for the Lucide ISC and Feather-derived MIT notices.
 */
import { omit } from "solid-js"
import type { JSX } from "@solidjs/web"

export interface TStaticIconProps extends Partial<JSX.SvgSVGAttributes<SVGSVGElement>> {
  size?: string | number
  color?: string
  strokeWidth?: string | number
  absoluteStrokeWidth?: boolean
}

interface TIconProps extends TStaticIconProps {
  name: string
  children: JSX.Element
}

function Icon(props: TIconProps) {
  const rest = omit(props, "name", "children", "size", "color", "strokeWidth", "absoluteStrokeWidth", "class")
  const strokeWidth = () => {
    const width = Number(props.strokeWidth ?? 2)
    return props.absoluteStrokeWidth ? width * 24 / Number(props.size ?? 24) : width
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke={props.color ?? "currentColor"}
      stroke-width={strokeWidth()}
      stroke-linecap="round"
      stroke-linejoin="round"
      {...rest}
      width={props.size ?? 24}
      height={props.size ?? 24}
      class={["lucide", "lucide-icon", `lucide-${props.name}`, props.class]}
      aria-hidden={props["aria-hidden"] ?? (props["aria-label"] === undefined && props.role === undefined ? "true" : undefined)}
    >
      {props.children}
    </svg>
  )
}

export const ArrowUp = (props: TStaticIconProps) => (
  <Icon name="arrow-up" {...props}><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></Icon>
)

export const Bot = (props: TStaticIconProps) => (
  <Icon name="bot" {...props}>
    <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
  </Icon>
)

export const ChevronDown = (props: TStaticIconProps) => (
  <Icon name="chevron-down" {...props}><path d="m6 9 6 6 6-6" /></Icon>
)

export const Database = (props: TStaticIconProps) => (
  <Icon name="database" {...props}>
    <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5V19A9 3 0 0 0 21 19V5" /><path d="M3 12A9 3 0 0 0 21 12" />
  </Icon>
)

export const FileText = (props: TStaticIconProps) => (
  <Icon name="file-text" {...props}>
    <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
    <path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" />
  </Icon>
)

export const Hand = (props: TStaticIconProps) => (
  <Icon name="hand" {...props}>
    <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2" /><path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2" />
    <path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </Icon>
)

export const ImageIcon = (props: TStaticIconProps) => (
  <Icon name="image" {...props}>
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </Icon>
)

export const KeyRound = (props: TStaticIconProps) => (
  <Icon name="key-round" {...props}>
    <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
    <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
  </Icon>
)

export const LockKeyhole = (props: TStaticIconProps) => (
  <Icon name="lock-keyhole" {...props}>
    <circle cx="12" cy="16" r="1" /><rect x="3" y="10" width="18" height="12" rx="2" /><path d="M7 10V7a5 5 0 0 1 10 0v3" />
  </Icon>
)

export const Puzzle = (props: TStaticIconProps) => (
  <Icon name="puzzle" {...props}>
    <path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z" />
  </Icon>
)

export const ShieldAlert = (props: TStaticIconProps) => (
  <Icon name="shield-alert" {...props}>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="M12 8v4" /><path d="M12 16h.01" />
  </Icon>
)

export const ShieldCheck = (props: TStaticIconProps) => (
  <Icon name="shield-check" {...props}>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
)

export const Square = (props: TStaticIconProps) => (
  <Icon name="square" {...props}><rect width="18" height="18" x="3" y="3" rx="2" /></Icon>
)

export const X = (props: TStaticIconProps) => (
  <Icon name="x" {...props}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Icon>
)

export const Zap = (props: TStaticIconProps) => (
  <Icon name="zap" {...props}>
    <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
  </Icon>
)
