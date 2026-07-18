import * as Lucid from "lucide-static"
import { VC_ELEMENT_DOM_PORTAL_SYNC_ATTR } from "@vibecanvas/canvas/core/CONSTANTS"

export const LUCIDE_STATIC_ICON_BY_KEY: Readonly<Record<string, string>> = Lucid

export const WIDGET_HOST_BORDER_ID = 'border'
export const WIDGET_HOST_HEADER_ID = 'header'
export const WIDGET_HOST_TITLE_ID = 'title'
export const WIDGET_HOST_BODY_ID = 'body'
export const WIDGET_HOST_DIVIDER_ID = 'divider'
export const WIDGET_HOST_CLOSE_BUTTON_ID = 'traffic-light-close'
export const WIDGET_HOST_MINIMIZE_BUTTON_ID = 'traffic-light-minimize'
export const WIDGET_HOST_MAXIMIZE_BUTTON_ID = 'traffic-light-maximize'
export const WIDGET_HOST_MENU_BUTTON_ID = 'header-menu'
export const WIDGET_HOST_MENU_BUTTON_HIT_ID = 'header-menu-hit'
export const WIDGET_HOST_MENU_BUTTON_DOT_ID = 'header-menu-dot'

export const WIDGET_HOST_MIN_WIDTH = 100
export const WIDGET_HOST_MIN_BODY_HEIGHT = 48
export const WIDGET_HOST_HEADER_HEIGHT = 28
export const WIDGET_HOST_MIN_HEIGHT = WIDGET_HOST_HEADER_HEIGHT + WIDGET_HOST_MIN_BODY_HEIGHT
export const WIDGET_HOST_DIVIDER_HEIGHT = 1
export const WIDGET_HOST_WINDOW_CORNER_RADIUS = 10
export const WIDGET_HOST_WINDOW_STROKE_WIDTH = 1
export const WIDGET_DOM_CONTENT_SCALE = 0.75

export const WIDGET_HOST_TRAFFIC_LIGHT_RADIUS = 5
export const WIDGET_HOST_TRAFFIC_LIGHT_Y = WIDGET_HOST_HEADER_HEIGHT / 2
export const WIDGET_HOST_TRAFFIC_LIGHT_START_X = 16
export const WIDGET_HOST_TRAFFIC_LIGHT_SPACING = 14
export const WIDGET_HOST_TITLE_MENU_GAP = 8
export const WIDGET_HOST_MENU_BUTTON_SIZE = 22
export const WIDGET_HOST_MENU_BUTTON_RIGHT_INSET = 6
export const WIDGET_HOST_MENU_DOT_RADIUS = 1.5
export const WIDGET_HOST_MENU_DOT_SPACING = 5

export const WIDGET_DOM_PORTAL_SYNC_ATTR = VC_ELEMENT_DOM_PORTAL_SYNC_ATTR
export const WIDGET_DOM_PORTAL_FULLSCREEN_Z_INDEX = '10000'
export const WIDGET_WINDOW_CONTAINED = 'contained'
export const WIDGET_WINDOW_FULLSCREEN = 'fullscreen'
