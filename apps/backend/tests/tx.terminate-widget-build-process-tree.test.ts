import { describe, expect, test } from 'bun:test';
import { terminateWidgetBuildProcessTree } from '../src/shell/widget/terminate-widget-build-process-tree';

describe('terminateWidgetBuildProcessTree', () => {
  test('kills a complete POSIX process group', async () => {
    const calls: string[] = [];
    await terminateWidgetBuildProcessTree({
      platform: 'darwin',
      killProcessGroup(pid) {
        calls.push(`group:${pid}`);
      },
      async taskkill(pid) {
        calls.push(`taskkill:${pid}`);
        return true;
      },
    }, {
      pid: 42,
      killDirect() {
        calls.push('direct');
      },
    });
    expect(calls).toEqual(['group:42']);
  });

  test('uses Windows task-tree termination and waits for confirmation', async () => {
    const calls: string[] = [];
    let confirmTaskkill: ((confirmed: boolean) => void) | undefined;
    const pending = terminateWidgetBuildProcessTree({
      platform: 'win32',
      killProcessGroup(pid) {
        calls.push(`group:${pid}`);
      },
      taskkill(pid) {
        calls.push(`taskkill:${pid}`);
        return new Promise((resolve) => {
          confirmTaskkill = resolve;
        });
      },
    }, {
      pid: 84,
      killDirect() {
        calls.push('direct');
      },
    });
    expect(calls).toEqual(['taskkill:84']);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    confirmTaskkill?.(true);
    await pending;
    expect(calls).toEqual(['taskkill:84']);
  });

  test('falls back to the direct child when group or task-tree cleanup fails', async () => {
    const posixCalls: string[] = [];
    await terminateWidgetBuildProcessTree({
      platform: 'linux',
      killProcessGroup() {
        posixCalls.push('group');
        throw new Error('missing group');
      },
      async taskkill() {
        posixCalls.push('taskkill');
        return false;
      },
    }, {
      pid: 21,
      killDirect() {
        posixCalls.push('direct');
      },
    });
    expect(posixCalls).toEqual(['group', 'direct']);

    const windowsCalls: string[] = [];
    await terminateWidgetBuildProcessTree({
      platform: 'win32',
      killProcessGroup() {
        windowsCalls.push('group');
      },
      async taskkill() {
        windowsCalls.push('taskkill');
        return false;
      },
    }, {
      pid: 22,
      killDirect() {
        windowsCalls.push('direct');
      },
    });
    expect(windowsCalls).toEqual(['taskkill', 'direct']);
  });
});
