/**
 * @file SolidJS presentation chrome for widgets hosted in fullscreen mode.
 */
import { For, onCleanup, onMount, type Component } from "solid-js";
import {
  WIDGET_DOM_PORTAL_FULLSCREEN_Z_INDEX,
  WIDGET_HOST_DIVIDER_HEIGHT,
  WIDGET_HOST_HEADER_HEIGHT,
  WIDGET_HOST_MENU_BUTTON_RIGHT_INSET,
  WIDGET_HOST_MENU_BUTTON_SIZE,
  WIDGET_HOST_MENU_DOT_RADIUS,
  WIDGET_HOST_MENU_DOT_SPACING,
  WIDGET_HOST_TITLE_MENU_GAP,
  WIDGET_HOST_TRAFFIC_LIGHT_RADIUS,
  WIDGET_HOST_TRAFFIC_LIGHT_SPACING,
  WIDGET_HOST_TRAFFIC_LIGHT_START_X,
  WIDGET_HOST_WINDOW_CORNER_RADIUS,
} from "./CONSTANTS";
import type { THostThemeColors } from "./types";
import styles from "./FullscreenWidgetHeader.module.css";

export type TFullscreenWidgetTitleAction = {
  id: string;
  label: string;
  pressed?: boolean;
  disabled?: boolean;
};

export type TFullscreenWidgetHeaderProps = {
  widgetId: string;
  visible: boolean;
  width: number;
  label: string;
  colors: THostThemeColors;
  titleActions: readonly TFullscreenWidgetTitleAction[];
  onClose: () => void;
  onMinimize: () => void;
  onExitFullscreen: () => void;
  onOpenMenu: (button: HTMLButtonElement) => void;
  onTitleAction: (id: string) => void;
};

type TTrafficLightProps = {
  action: "close" | "minimize" | "exit-fullscreen";
  label: string;
  fill: string;
  stroke: string;
  glyph: string;
  onSelect: () => void;
};

const trafficLightDiameter = WIDGET_HOST_TRAFFIC_LIGHT_RADIUS * 2;
const trafficLightGap = WIDGET_HOST_TRAFFIC_LIGHT_SPACING - trafficLightDiameter;
const trafficLightLeftInset = WIDGET_HOST_TRAFFIC_LIGHT_START_X - WIDGET_HOST_TRAFFIC_LIGHT_RADIUS;
const titleLeftGap = WIDGET_HOST_TRAFFIC_LIGHT_SPACING - WIDGET_HOST_TRAFFIC_LIGHT_RADIUS;
const menuDotDiameter = WIDGET_HOST_MENU_DOT_RADIUS * 2;
const menuDotGap = WIDGET_HOST_MENU_DOT_SPACING - menuDotDiameter;

const TrafficLight: Component<TTrafficLightProps> = (props) => (
  <button
    type="button"
    class={styles.trafficLight}
    data-widget-fullscreen-control={props.action}
    aria-label={props.label}
    title={props.label}
    style={{
      width: `${trafficLightDiameter}px`,
      height: `${trafficLightDiameter}px`,
      "background-color": props.fill,
      "border-color": props.stroke,
    }}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => {
      event.preventDefault();
      event.stopPropagation();
      props.onSelect();
    }}
  >
    <span class={styles.trafficGlyph} aria-hidden="true">{props.glyph}</span>
  </button>
);

export const FullscreenWidgetHeader: Component<TFullscreenWidgetHeaderProps> = (props) => {
  let header!: HTMLDivElement;
  const hostEventTypes = [
    "pointerdown",
    "pointermove",
    "pointerup",
    "pointercancel",
    "dblclick",
    "wheel",
    "keydown",
    "keyup",
    "contextmenu",
  ];
  const stopHostEvent = (event: Event) => event.stopPropagation();

  onMount(() => hostEventTypes.forEach((eventType) => header.addEventListener(eventType, stopHostEvent)));
  onCleanup(() => hostEventTypes.forEach((eventType) => header.removeEventListener(eventType, stopHostEvent)));

  return <div
    ref={header}
    class={styles.header}
    data-widget-fullscreen-header-id={props.widgetId}
    role="toolbar"
    aria-label={`${props.label} window controls`}
    aria-hidden={props.visible ? undefined : "true"}
    style={{
      display: props.visible ? "flex" : "none",
      width: `${props.width}px`,
      height: `${WIDGET_HOST_HEADER_HEIGHT}px`,
      color: props.colors.headerTitleFill,
      "background-color": props.colors.headerFill,
      "border-bottom": `${WIDGET_HOST_DIVIDER_HEIGHT}px solid ${props.colors.dividerFill}`,
      "border-radius": `${WIDGET_HOST_WINDOW_CORNER_RADIUS}px ${WIDGET_HOST_WINDOW_CORNER_RADIUS}px 0 0`,
      "z-index": WIDGET_DOM_PORTAL_FULLSCREEN_Z_INDEX,
    }}
  >
    <div
      class={styles.trafficLights}
      style={{
        gap: `${trafficLightGap}px`,
        "margin-left": `${trafficLightLeftInset}px`,
      }}
    >
      <TrafficLight
        action="close"
        label="Close widget"
        fill={props.colors.closeButtonFill}
        stroke={props.colors.trafficLightStroke}
        glyph="×"
        onSelect={props.onClose}
      />
      <TrafficLight
        action="minimize"
        label="Minimize widget"
        fill={props.colors.minimizeButtonFill}
        stroke={props.colors.trafficLightStroke}
        glyph="−"
        onSelect={props.onMinimize}
      />
      <TrafficLight
        action="exit-fullscreen"
        label="Exit fullscreen"
        fill={props.colors.maximizeButtonFill}
        stroke={props.colors.trafficLightStroke}
        glyph="↙"
        onSelect={props.onExitFullscreen}
      />
    </div>

    <div
      class={styles.title}
      data-widget-fullscreen-title
      title={props.label}
      style={{
        "margin-left": `${titleLeftGap}px`,
        "margin-right": `${WIDGET_HOST_TITLE_MENU_GAP}px`,
        overflow: "hidden",
        "text-overflow": "ellipsis",
        "white-space": "nowrap",
      }}
    >
      {props.label}
    </div>

    <div class={styles.actions} style={{ gap: "4px" }}>
      <For each={props.titleActions}>
        {(action) => (
          <button
            type="button"
            class={styles.titleAction}
            data-widget-title-action-id={action.id}
            data-pressed={action.pressed ? "true" : undefined}
            aria-label={action.label}
            aria-pressed={action.pressed}
            title={action.label}
            disabled={action.disabled}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onTitleAction(action.id);
            }}
          >
            {action.label}
          </button>
        )}
      </For>

      <button
        type="button"
        class={styles.menuButton}
        data-widget-fullscreen-menu-button={props.widgetId}
        aria-label="Widget actions"
        aria-haspopup="menu"
        title="Widget actions"
        style={{
          width: `${WIDGET_HOST_MENU_BUTTON_SIZE}px`,
          height: `${WIDGET_HOST_MENU_BUTTON_SIZE}px`,
          "margin-right": `${WIDGET_HOST_MENU_BUTTON_RIGHT_INSET}px`,
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onOpenMenu(event.currentTarget);
        }}
      >
        <span class={styles.menuDots} aria-hidden="true" style={{ gap: `${menuDotGap}px` }}>
          <span class={styles.menuDot} style={{ width: `${menuDotDiameter}px`, height: `${menuDotDiameter}px` }} />
          <span class={styles.menuDot} style={{ width: `${menuDotDiameter}px`, height: `${menuDotDiameter}px` }} />
          <span class={styles.menuDot} style={{ width: `${menuDotDiameter}px`, height: `${menuDotDiameter}px` }} />
        </span>
      </button>
    </div>
  </div>;
};
