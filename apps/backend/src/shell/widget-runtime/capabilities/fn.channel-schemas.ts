import type {
  CapsuleSchemaDocument,
  CapsuleSchemaNode,
} from '@omnidraw/capsule/schema';
import { fnOmnidrawBoundedJsonValueSchema } from './fn.bounded-json-schema';

const COLLECTION_MAX_ITEMS = 64;
const THEME_TOKEN_MAX_BYTES = 128;
const NOTIFICATION_MESSAGE_MAX_BYTES = 512;

function themeTokenSchema(): CapsuleSchemaNode {
  return { type: 'string', minBytes: 1, maxBytes: THEME_TOKEN_MAX_BYTES };
}

/** Fixed bounded JSON record intentionally persisted on a widget instance. */
export function fnOmnidrawWidgetPropsSchemaDocument(): CapsuleSchemaDocument {
  return {
    format: 'capsule-schema-v1',
    root: {
      type: 'object',
      properties: {},
      additionalProperties: fnOmnidrawBoundedJsonValueSchema(),
      maxProperties: COLLECTION_MAX_ITEMS,
    },
  };
}

/** Fixed semantic theme tokens; no ThemeService object or stylesheet crosses. */
export function fnOmnidrawWidgetThemeSchemaDocument(): CapsuleSchemaDocument {
  const tokens = {
    background: themeTokenSchema(),
    foreground: themeTokenSchema(),
    surface: themeTokenSchema(),
    surfaceForeground: themeTokenSchema(),
    muted: themeTokenSchema(),
    mutedForeground: themeTokenSchema(),
    primary: themeTokenSchema(),
    primaryForeground: themeTokenSchema(),
    accent: themeTokenSchema(),
    accentForeground: themeTokenSchema(),
    destructive: themeTokenSchema(),
    success: themeTokenSchema(),
    border: themeTokenSchema(),
  };
  return {
    format: 'capsule-schema-v1',
    root: {
      type: 'object',
      properties: {
        format: {
          type: 'literal',
          value: 'omnidraw.widget-theme.v1',
        },
        appearance: {
          type: 'union',
          variants: [
            { type: 'literal', value: 'light' },
            { type: 'literal', value: 'dark' },
          ],
        },
        tokens: {
          type: 'object',
          properties: tokens,
          required: Object.keys(tokens).sort(),
          minProperties: Object.keys(tokens).length,
          maxProperties: Object.keys(tokens).length,
        },
      },
      required: ['appearance', 'format', 'tokens'],
      minProperties: 3,
      maxProperties: 3,
    },
  };
}

/** Fixed bounded guest event mapped to one host-owned notification action. */
export function fnOmnidrawWidgetOutputSchemaDocument(): CapsuleSchemaDocument {
  return {
    format: 'capsule-schema-v1',
    root: {
      type: 'object',
      properties: {
        type: { type: 'literal', value: 'notification' },
        tone: {
          type: 'union',
          variants: [
            { type: 'literal', value: 'info' },
            { type: 'literal', value: 'success' },
            { type: 'literal', value: 'error' },
          ],
        },
        message: {
          type: 'string',
          minBytes: 1,
          maxBytes: NOTIFICATION_MESSAGE_MAX_BYTES,
        },
      },
      required: ['message', 'tone', 'type'],
      minProperties: 3,
      maxProperties: 3,
    },
  };
}
