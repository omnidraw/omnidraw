import { describe, expect, test } from 'bun:test';
import { fnWidgetTypescriptCommand } from '#backend/core/agent/fn.widget-typescript-command';

describe('fnWidgetTypescriptCommand', () => {
  test('runs the widget compiler through npm without requiring Bun', () => {
    expect(fnWidgetTypescriptCommand('/widget/tsconfig.json')).toEqual({
      file: 'npm',
      args: [
        'exec',
        '--yes',
        '--package=typescript@5.9.3',
        '--',
        'tsc',
        '--pretty',
        'false',
        '--noEmit',
        '-p',
        '/widget/tsconfig.json',
      ],
    });
  });
});
