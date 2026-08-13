const IMAGE_FILE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';

export function createCanvasImageInput(
  container: HTMLDivElement,
  disabled: boolean,
): HTMLInputElement {
  const input = container.ownerDocument.createElement('input');
  input.type = 'file';
  input.accept = IMAGE_FILE_ACCEPT;
  input.multiple = true;
  input.hidden = true;
  input.disabled = disabled;
  input.dataset.omnidrawImageInput = '';
  container.append(input);
  return input;
}

export function findCanvasWidgetPortalHost(
  container: HTMLElement,
  portalId: string,
): HTMLElement | null {
  for (const element of container.querySelectorAll<HTMLElement>(
    '[data-vibecanvas-portal-id]',
  )) {
    if (element.getAttribute('data-vibecanvas-portal-id') === portalId) {
      return element;
    }
  }
  return null;
}
