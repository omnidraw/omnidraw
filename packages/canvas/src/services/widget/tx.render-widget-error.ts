import type { TWidgetError } from '@vibecanvas/service-db/model';

type TPortal = {
  document: Document;
};

type TArgs = {
  root: HTMLElement;
  error: TWidgetError;
  replaceContent?: boolean;
};

export function txRenderWidgetError(portal: TPortal, args: TArgs): void {
  args.root.querySelector('[data-widget-host-error]')?.remove();
  if (args.replaceContent !== false) args.root.replaceChildren();
  args.root.style.position = 'relative';
  const alert = portal.document.createElement('div');
  alert.setAttribute('role', 'alert');
  alert.dataset.widgetErrorCode = args.error.code;
  alert.dataset.widgetHostError = 'true';
  alert.style.position = 'absolute';
  alert.style.inset = '0';
  alert.style.zIndex = '10';
  alert.style.boxSizing = 'border-box';
  alert.style.display = 'flex';
  alert.style.alignItems = 'center';
  alert.style.justifyContent = 'center';
  alert.style.width = '100%';
  alert.style.minHeight = '100%';
  alert.style.padding = 'clamp(18px, 6%, 48px)';
  alert.style.color = 'var(--foreground, #111111)';
  alert.style.background = 'var(--background, #ffffff)';
  alert.style.fontFamily = 'var(--vc-terminal-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace)';
  alert.style.overflowWrap = 'anywhere';

  const panel = portal.document.createElement('div');
  panel.style.boxSizing = 'border-box';
  panel.style.width = 'min(100%, 620px)';
  panel.style.border = '2px solid var(--foreground, #111111)';
  panel.style.background = 'var(--background, #ffffff)';
  panel.style.boxShadow = '8px 8px 0 color-mix(in srgb, var(--foreground, #111111) 78%, var(--background, #ffffff))';

  const heading = portal.document.createElement('div');
  heading.style.display = 'flex';
  heading.style.alignItems = 'center';
  heading.style.justifyContent = 'space-between';
  heading.style.gap = '12px';
  heading.style.padding = '8px 10px';
  heading.style.borderBottom = '2px solid var(--foreground, #111111)';
  heading.style.background = 'var(--destructive, #ef4444)';
  heading.style.color = 'var(--destructive-foreground, #ffffff)';
  heading.style.fontSize = '11px';
  heading.style.fontWeight = '900';
  heading.style.letterSpacing = '0.08em';
  heading.style.textTransform = 'uppercase';

  const title = portal.document.createElement('span');
  title.textContent = 'Widget fault';
  const code = portal.document.createElement('span');
  code.style.textAlign = 'right';
  code.style.overflowWrap = 'anywhere';
  code.textContent = args.error.code;
  heading.append(title, code);

  const body = portal.document.createElement('div');
  body.style.padding = '14px 16px 16px';

  const phase = portal.document.createElement('div');
  phase.style.marginBottom = '10px';
  phase.style.fontSize = '10px';
  phase.style.fontWeight = '800';
  phase.style.letterSpacing = '0.08em';
  phase.style.textTransform = 'uppercase';
  phase.style.opacity = '0.62';
  phase.textContent = `Phase // ${args.error.phase}`;

  const message = portal.document.createElement('div');
  message.style.fontSize = '13px';
  message.style.fontWeight = '750';
  message.style.lineHeight = '1.55';
  message.textContent = `[Error loading Widget: ${args.error.message}]`;

  body.append(phase, message);
  panel.append(heading, body);
  alert.appendChild(panel);
  args.root.appendChild(alert);
}
