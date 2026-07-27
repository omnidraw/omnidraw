import * as Lucid from 'lucide-static'
import { z } from 'zod'
import type { TLucidStaticIconKey, TVibecanvasToolIcon } from './types'

export const LUCIDE_STATIC_ICON_KEYS = Object.keys(Lucid).sort()
export const LUCIDE_STATIC_ICON_KEY_SET = new Set<string>(LUCIDE_STATIC_ICON_KEYS)

export const RECOMMENDED_LUCIDE_STATIC_ICON_KEYS = [
  'Search', 'Plus', 'Minus', 'Check', 'X', 'Pencil', 'Trash2', 'Copy', 'Save', 'Download',
  'Upload', 'RefreshCw', 'Filter', 'Settings',
  'Home', 'Menu', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'LayoutDashboard',
  'LayoutGrid', 'List', 'Table',
  'Calendar', 'Clock', 'AlarmClock', 'Clipboard', 'ClipboardCheck', 'ListChecks', 'File',
  'FileText', 'Folder', 'FolderOpen', 'Archive', 'Inbox',
  'Mail', 'Send', 'MessageCircle', 'MessageSquare', 'Bell', 'BellRing', 'Phone', 'Mic', 'Video',
  'Paperclip',
  'User', 'Users', 'UserPlus', 'LogIn', 'LogOut', 'Lock', 'Unlock', 'Key', 'Shield', 'BadgeCheck',
  'Database', 'ChartBar', 'ChartLine', 'ChartPie', 'Activity', 'Gauge', 'Code', 'Terminal', 'Bot',
  'Cog', 'Wrench', 'SlidersHorizontal',
  'Image', 'Camera', 'Play', 'Pause', 'Music', 'Volume2', 'Palette', 'PenTool', 'Type', 'Eye',
  'ShoppingCart', 'ShoppingBag', 'CreditCard', 'Wallet', 'Package', 'Gift', 'Briefcase', 'Tag',
  'Box',
  'Globe', 'Map', 'MapPin', 'Compass', 'Cloud', 'Wifi',
  'Heart', 'Star', 'Lightbulb', 'Sparkles', 'Info', 'CircleHelp', 'Flag',
] as const

export function isLucideStaticIconKey(value: unknown): value is TLucidStaticIconKey {
  return typeof value === 'string' && LUCIDE_STATIC_ICON_KEY_SET.has(value)
}

export const ZVibecanvasToolIcon: z.ZodType<TVibecanvasToolIcon> = z.object({
  lucidIcon: z.custom<string>(
    isLucideStaticIconKey,
    `expected one of: ${LUCIDE_STATIC_ICON_KEYS.join(', ')}`,
  ).optional(),
  svgIcon: z.string().min(1).optional(),
}).strict().refine((icon) => icon.lucidIcon !== undefined || icon.svgIcon !== undefined, {
  message: 'expected at least one of lucidIcon or svgIcon',
})
