type TPortal = {
  document: Document;
};

type TArgs = {
  root: HTMLElement;
};

export function txRenderWidgetLoading(portal: TPortal, args: TArgs): void {
  args.root.querySelector('[data-widget-host-error]')?.remove();
  if (args.root.querySelector('[data-widget-host-loading]')) return;

  args.root.style.position = 'relative';
  const loading = portal.document.createElement('div');
  loading.dataset.widgetHostLoading = 'true';
  loading.setAttribute('role', 'status');
  loading.setAttribute('aria-live', 'polite');
  loading.style.position = 'absolute';
  loading.style.inset = '0';
  loading.style.zIndex = '9';
  loading.style.display = 'flex';
  loading.style.alignItems = 'center';
  loading.style.justifyContent = 'center';
  loading.style.background = 'var(--background, #ffffff)';
  loading.style.color = 'var(--foreground, #111111)';
  loading.style.fontFamily = 'var(--vc-terminal-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace)';
  loading.style.fontSize = '12px';
  loading.style.fontWeight = '700';
  loading.textContent = 'Loading widget…';
  args.root.appendChild(loading);
}
