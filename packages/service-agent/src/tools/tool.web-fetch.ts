import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { fnToolError, fnToolSuccess } from './fn.result';
import type { TToolDefinition } from './types';

type TWebFetchFormat = 'raw' | 'text' | 'markdown';

type TWebFetchResult = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title?: string;
  format: TWebFetchFormat;
  content: string;
  truncated: boolean;
  likelySpa: boolean;
  spaReason?: string;
};

const DEFAULT_FORMAT: TWebFetchFormat = 'markdown';
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 1_000_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_MAX_BYTES = 10_000_000;
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 OmnidrawWebFetch/1.0';

const WEB_FETCH_PARAMETER_SCHEMA = Type.Object({
  url: Type.String({
    minLength: 1,
    description: 'HTTP or HTTPS URL to fetch without browser rendering.',
  }),
  format: Type.Optional(Type.Union([
    Type.Literal('raw'),
    Type.Literal('text'),
    Type.Literal('markdown'),
  ], { description: 'Output format. Defaults to markdown.' })),
  timeoutMs: Type.Optional(Type.Number({
    minimum: 1,
    maximum: MAX_TIMEOUT_MS,
    description: 'Fetch timeout in milliseconds. Defaults to 8000.',
  })),
  maxBytes: Type.Optional(Type.Number({
    minimum: 1,
    maximum: MAX_MAX_BYTES,
    description: 'Maximum response bytes to read. Defaults to 1000000.',
  })),
}, { additionalProperties: false });

export function createWebFetchTool(): TToolDefinition {
  return defineTool({
    name: 'web_fetch',
    label: 'Web Fetch',
    description: 'Fetch a URL without browser rendering and return raw, text, or markdown content. Detects likely SPA/app-shell pages instead of running JavaScript.',
    parameters: WEB_FETCH_PARAMETER_SCHEMA,
    async execute(_toolCallId, params: any) {
      const normalized = fnNormalizeWebFetchParams(params);
      if (!normalized.ok) {
        const modelData = { likelySpa: false };
        return fnToolError({ code: 'WEB_FETCH_INVALID_INPUT', message: normalized.error, modelData, details: modelData });
      }

      try {
        const result = await fnFetchUrl(normalized.value);
        return fnToolSuccess({ summary: fnRenderWebFetchToolText(result), modelData: result, details: result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const modelData = {
          url: normalized.value.url,
          format: normalized.value.format,
          likelySpa: false,
        };
        return fnToolError({
          code: 'WEB_FETCH_FAILED',
          message: `web_fetch failed: ${message}`,
          modelData,
          details: modelData,
        });
      }
    },
  }) as TToolDefinition;
}

function fnRenderWebFetchToolText(result: TWebFetchResult): string {
  const lines = [
    `Fetched ${result.finalUrl} as ${result.format}.`,
    `Status: ${result.status}`,
    `Content-Type: ${result.contentType || 'unknown'}`,
  ];

  if (result.title) {
    lines.push(`Title: ${result.title}`);
  }

  if (result.truncated) {
    lines.push('Truncated: true');
  }

  if (result.likelySpa) {
    lines.push(`Likely SPA: true${result.spaReason ? ` (${result.spaReason})` : ''}`);
  }

  lines.push('', 'Content:', result.content || '[empty]');
  return lines.join('\n');
}

function fnNormalizeWebFetchParams(params: unknown): { ok: true; value: { url: string; format: TWebFetchFormat; timeoutMs: number; maxBytes: number } } | { ok: false; error: string } {
  if (!params || typeof params !== 'object') {
    return { ok: false, error: 'web_fetch requires a URL.' };
  }

  const input = params as Record<string, unknown>;
  if (typeof input.url !== 'string' || input.url.trim() === '') {
    return { ok: false, error: 'web_fetch requires url to be a non-empty string.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return { ok: false, error: 'web_fetch requires a valid URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'web_fetch only supports http:// and https:// URLs.' };
  }

  const format = input.format === undefined ? DEFAULT_FORMAT : input.format;
  if (format !== 'raw' && format !== 'text' && format !== 'markdown') {
    return { ok: false, error: 'web_fetch format must be raw, text, or markdown.' };
  }

  const timeoutMs = fnBoundedInteger(input.timeoutMs, DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS);
  const maxBytes = fnBoundedInteger(input.maxBytes, DEFAULT_MAX_BYTES, 1, MAX_MAX_BYTES);

  return {
    ok: true,
    value: {
      url: parsed.toString(),
      format,
      timeoutMs,
      maxBytes,
    },
  };
}

function fnBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

async function fnFetchUrl(args: { url: string; format: TWebFetchFormat; timeoutMs: number; maxBytes: number }): Promise<TWebFetchResult> {
  const response = await fetch(args.url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(args.timeoutMs),
    headers: {
      accept: fnAcceptHeader(args.format),
      'user-agent': BROWSER_USER_AGENT,
    },
  });

  const contentType = response.headers.get('content-type') ?? '';
  const contentLength = fnParseContentLength(response.headers.get('content-length'));
  const body = await fnReadResponseBody(response, args.maxBytes);
  const truncated = body.truncated || (contentLength !== undefined && contentLength > args.maxBytes);
  const rawContent = new TextDecoder('utf-8', { fatal: false }).decode(body.bytes);
  const isHtml = fnIsHtml(contentType, rawContent);
  const html = isHtml ? rawContent : undefined;
  const title = html ? fnExtractTitle(html) : undefined;
  const content = fnFormatContent(rawContent, contentType, args.format);
  const spa = html ? fnDetectLikelySpa(html, content) : { likelySpa: false };

  return {
    url: args.url,
    finalUrl: response.url,
    status: response.status,
    contentType,
    title,
    format: args.format,
    content,
    truncated,
    likelySpa: spa.likelySpa,
    spaReason: spa.reason,
  };
}

function fnAcceptHeader(format: TWebFetchFormat): string {
  if (format === 'raw') {
    return '*/*';
  }

  if (format === 'text') {
    return 'text/plain,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
  }

  return 'text/html,application/xhtml+xml,text/plain,application/xml;q=0.9,*/*;q=0.8';
}

function fnParseContentLength(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

async function fnReadResponseBody(response: Response, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    return {
      bytes: bytes.slice(0, maxBytes),
      truncated: bytes.byteLength > maxBytes,
    };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    const remaining = maxBytes - total;
    if (value.byteLength > remaining) {
      if (remaining > 0) {
        chunks.push(value.slice(0, remaining));
        total += remaining;
      }
      truncated = true;
      await reader.cancel();
      break;
    }

    chunks.push(value);
    total += value.byteLength;

    if (total >= maxBytes) {
      const next = await reader.read();
      if (!next.done) {
        truncated = true;
        await reader.cancel();
      }
      break;
    }
  }

  return { bytes: fnConcatBytes(chunks, total), truncated };
}

function fnConcatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function fnIsHtml(contentType: string, content: string): boolean {
  const lower = contentType.toLowerCase();
  return lower.includes('text/html') || lower.includes('application/xhtml+xml') || /^\s*<!doctype html|^\s*<html[\s>]/i.test(content);
}

function fnFormatContent(content: string, contentType: string, format: TWebFetchFormat): string {
  if (format === 'raw') {
    return content;
  }

  if (!fnIsHtml(contentType, content)) {
    return fnNormalizeWhitespace(content);
  }

  const cleaned = fnCleanHtml(content);
  if (format === 'text') {
    return fnHtmlToText(cleaned);
  }

  return fnHtmlToMarkdown(cleaned);
}

function fnCleanHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, ' ')
    .replace(/<template\b[\s\S]*?<\/template\s*>/gi, ' ')
    .replace(/<(meta|link|base|iframe|canvas|picture|source|img|input|button)\b[^>]*>/gi, ' ');
}

function fnExtractTitle(html: string): string | undefined {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (!match) {
    return undefined;
  }

  const title = fnDecodeHtmlEntities(fnStripTags(match[1])).trim();
  return title || undefined;
}

function fnHtmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\/(p|div|section|article|header|footer|main|aside|nav|li|tr|h[1-6]|blockquote)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)\s*>/gi, '\t');

  return fnNormalizeWhitespace(fnDecodeHtmlEntities(fnStripTags(withBreaks)));
}

function fnHtmlToMarkdown(html: string): string {
  let markdown = html
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi, '\n# $1\n')
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/gi, '\n## $1\n')
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3\s*>/gi, '\n### $1\n')
    .replace(/<h4\b[^>]*>([\s\S]*?)<\/h4\s*>/gi, '\n#### $1\n')
    .replace(/<h5\b[^>]*>([\s\S]*?)<\/h5\s*>/gi, '\n##### $1\n')
    .replace(/<h6\b[^>]*>([\s\S]*?)<\/h6\s*>/gi, '\n###### $1\n')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_match, href, text) => `[${fnInlineText(text)}](${href})`)
    .replace(/<strong\b[^>]*>([\s\S]*?)<\/strong\s*>/gi, '**$1**')
    .replace(/<b\b[^>]*>([\s\S]*?)<\/b\s*>/gi, '**$1**')
    .replace(/<em\b[^>]*>([\s\S]*?)<\/em\s*>/gi, '*$1*')
    .replace(/<i\b[^>]*>([\s\S]*?)<\/i\s*>/gi, '*$1*')
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi, '`$1`')
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, '\n```\n$1\n```\n')
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi, '\n- $1')
    .replace(/<\/(p|div|section|article|header|footer|main|aside|nav|ul|ol|blockquote|table|tr)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');

  markdown = fnDecodeHtmlEntities(fnStripTags(markdown))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return markdown;
}

function fnInlineText(html: string): string {
  return fnNormalizeWhitespace(fnDecodeHtmlEntities(fnStripTags(html))).replace(/[\[\]]/g, '');
}

function fnStripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function fnNormalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fnDecodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[lower] ?? match;
  });
}

function fnDetectLikelySpa(html: string, content: string): { likelySpa: boolean; reason?: string } {
  const lowerHtml = html.toLowerCase();
  const lowerContent = content.toLowerCase();
  const visibleText = fnHtmlToText(fnCleanHtml(html));
  const visibleWordCount = visibleText.split(/\s+/).filter(Boolean).length;
  const scriptCount = (lowerHtml.match(/<script\b/g) ?? []).length;
  const hasAppRoot = /<div\b[^>]*(id|class)=["'][^"']*(root|app|__next|nuxt|svelte|solid|vite)[^"']*["'][^>]*>\s*<\/div\s*>/i.test(html);
  const hasBundleScript = /<script\b[^>]+src=["'][^"']*(\/assets\/|bundle|chunk|main|app|index|vite|webpack|next)[^"']*\.m?js/i.test(html);
  const jsRequiredText = /(enable javascript|javascript is required|requires javascript|please enable js|need javascript)/i.test(html);
  const loadingShell = /\b(loading|please wait|initializing)\b/i.test(visibleText) && visibleWordCount <= 12 && scriptCount > 0;

  if (jsRequiredText || lowerContent.includes('javascript is required')) {
    return { likelySpa: true, reason: 'Page says JavaScript is required.' };
  }

  if (hasAppRoot && hasBundleScript && visibleWordCount <= 25) {
    return { likelySpa: true, reason: 'HTML contains an empty app root plus JavaScript bundle scripts.' };
  }

  if (loadingShell) {
    return { likelySpa: true, reason: 'Visible content is only a short loading shell with scripts.' };
  }

  if (scriptCount >= 3 && visibleWordCount <= 10 && lowerHtml.includes('<body')) {
    return { likelySpa: true, reason: 'HTML body has very little readable content and multiple scripts.' };
  }

  return { likelySpa: false };
}
