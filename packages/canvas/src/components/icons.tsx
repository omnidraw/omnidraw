/**
 * Bounded Canvas icon set derived from lucide-static v1.24.0 SVG data.
 * See the package LICENSE for the Lucide ISC and Feather-derived MIT notices.
 */
import type { JSX } from '@solidjs/web';
import {
  omit,
  type Component,
  type Element,
} from 'solid-js';

export type TCanvasIconProps = JSX.IntrinsicElements['svg'] & Readonly<{
  absoluteStrokeWidth?: boolean;
  color?: string;
  size?: number | string;
  strokeWidth?: number | string;
}>;

type TIconShellProps = TCanvasIconProps & Readonly<{
  children: Element;
  iconName: string;
}>;

function hasAccessibleName(props: TIconShellProps): boolean {
  return Object.keys(props).some((key) => (
    key.startsWith('aria-') || key === 'role' || key === 'title'
  ));
}

const IconShell: Component<TIconShellProps> = (props) => {
  const forwarded = omit(
    props,
    'absoluteStrokeWidth',
    'children',
    'class',
    'color',
    'height',
    'iconName',
    'size',
    'stroke',
    'stroke-width',
    'strokeWidth',
    'width',
    'aria-hidden',
  );
  const resolvedStrokeWidth = () => {
    const strokeWidth = Number(props['stroke-width'] ?? props.strokeWidth ?? 2);
    const size = Number(props.size ?? 24);
    return props.absoluteStrokeWidth === true && Number.isFinite(size) && size !== 0
      ? strokeWidth * 24 / size
      : strokeWidth;
  };
  const ariaHidden = () => props['aria-hidden'] ?? (
    hasAccessibleName(props) ? undefined : 'true'
  );

  return (
    <svg
      {...forwarded}
      xmlns="http://www.w3.org/2000/svg"
      width={props.width ?? props.size ?? 24}
      height={props.height ?? props.size ?? 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke={props.stroke ?? props.color ?? 'currentColor'}
      stroke-width={resolvedStrokeWidth()}
      stroke-linecap="round"
      stroke-linejoin="round"
      class={[
        'lucide',
        'lucide-icon',
        `lucide-${props.iconName}`,
        props.class,
      ]}
      aria-hidden={ariaHidden()}
    >
      {props.children}
    </svg>
  );
};

export const ArrowRightIcon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="arrow-right">
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </IconShell>
);

export const BugIcon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="bug">
    <path d="M12 20v-9" />
    <path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z" />
    <path d="M14.12 3.88 16 2" />
    <path d="M21 21a4 4 0 0 0-3.81-4" />
    <path d="M21 5a4 4 0 0 1-3.55 3.97" />
    <path d="M22 13h-4" />
    <path d="M3 21a4 4 0 0 1 3.81-4" />
    <path d="M3 5a4 4 0 0 0 3.55 3.97" />
    <path d="M6 13H2" />
    <path d="m8 2 1.88 1.88" />
    <path d="M9 7.13V6a3 3 0 1 1 6 0v1.13" />
  </IconShell>
);

export const CircleIcon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="circle">
    <circle cx="12" cy="12" r="10" />
  </IconShell>
);

export const CircleStopIcon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="circle-stop">
    <circle cx="12" cy="12" r="10" />
    <rect x="9" y="9" width="6" height="6" rx="1" />
  </IconShell>
);

export const ClipboardIcon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="clipboard">
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  </IconShell>
);

export const DownloadIcon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="download">
    <path d="M12 15V3" />
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5" />
  </IconShell>
);

export const EraserIcon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="eraser">
    <path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21" />
    <path d="m5.082 11.09 8.828 8.828" />
  </IconShell>
);

export const FlagIcon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="flag">
    <path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528" />
  </IconShell>
);

export const Grid2x2Icon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="grid-2x2">
    <path d="M12 3v18" />
    <path d="M3 12h18" />
    <rect x="3" y="3" width="18" height="18" rx="2" />
  </IconShell>
);

export const HandIcon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="hand">
    <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
    <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />
    <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </IconShell>
);

export const ImageIcon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="image">
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </IconShell>
);

export const MinusIcon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="minus">
    <path d="M5 12h14" />
  </IconShell>
);

export const MousePointer2Icon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="mouse-pointer-2">
    <path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" />
  </IconShell>
);

export const PencilIcon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="pencil">
    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    <path d="m15 5 4 4" />
  </IconShell>
);

export const RadioIcon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="radio">
    <path d="M16.247 7.761a6 6 0 0 1 0 8.478" />
    <path d="M19.075 4.933a10 10 0 0 1 0 14.134" />
    <path d="M4.925 19.067a10 10 0 0 1 0-14.134" />
    <path d="M7.753 16.239a6 6 0 0 1 0-8.478" />
    <circle cx="12" cy="12" r="2" />
  </IconShell>
);

export const Redo2Icon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="redo-2">
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />
  </IconShell>
);

export const SquareIcon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="square">
    <rect width="18" height="18" x="3" y="3" rx="2" />
  </IconShell>
);

export const Trash2Icon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="trash-2">
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </IconShell>
);

export const TypeIcon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="type">
    <path d="M12 4v16" />
    <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" />
    <path d="M9 20h6" />
  </IconShell>
);

export const Undo2Icon: Component<TCanvasIconProps> = (props) => (
  <IconShell {...props} iconName="undo-2">
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
  </IconShell>
);
