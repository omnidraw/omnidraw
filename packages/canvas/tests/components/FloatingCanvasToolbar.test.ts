import { render } from 'solid-js/web';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { FloatingCanvasToolbar } from '../../src/components/FloatingCanvasToolbar';

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.replaceChildren();
});

describe('FloatingCanvasToolbar', () => {
  test('shows the dedicated AI Chat tool and selects Cangine widget creation', () => {
    const onSelectTool = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    dispose = render(() => FloatingCanvasToolbar({
      activeToolId: null,
      canRedo: false,
      canUndo: false,
      gridVisible: true,
      sidebarVisible: true,
      onRedo: () => {},
      onSelectTool,
      onToggleGrid: () => {},
      onToggleSidebar: () => {},
      onUndo: () => {},
    }), host);

    const aiChatButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="AI Chat"]',
    );
    expect(aiChatButton).not.toBeNull();
    expect(aiChatButton?.textContent).toContain('C');

    aiChatButton?.click();

    expect(onSelectTool).toHaveBeenCalledOnce();
    expect(onSelectTool).toHaveBeenCalledWith('widget');
  });
});
