import type { TElement } from '@vibecanvas/service-automerge/types/canvas-doc';
import { afterEach, describe, expect, test } from 'bun:test';
import { createCliTestContext, createGroup, createRectElement, expectExitCode, expectNoStderr, parseJsonStdout, type TCliTestContext } from '../harness';

const contexts: TCliTestContext[] = [];

afterEach(async () => {
  while (contexts.length > 0) {
    await contexts.pop()?.cleanup();
  }
});

async function createContext(): Promise<TCliTestContext> {
  const context = await createCliTestContext();
  contexts.push(context);
  return context;
}

describe('canvas CLI query', () => {
  test('matches exact ids and defaults to summary mode in --json', async () => {
    const context = await createContext();
    const group = createGroup({ id: 'group-root', zIndex: 'a0', createdAt: 1712000000000 });
    const element = createRectElement({
      id: 'rect-1',
      x: 120,
      y: 240,
      zIndex: 'a1',
      parentGroupId: group.id,
      createdAt: 1712345678000,
      updatedAt: 1712345678999,
      data: { w: 320, h: 180 },
    });
    const seeded = await context.seedCanvasFixture({ name: 'query-ids-canvas', elements: { [element.id]: element }, groups: { [group.id]: group } });

    const result = await context.runCanvasCli(['query', '--canvas', seeded.canvas.id, '--id', element.id, '--id', group.id, '--json']);

    expectExitCode(result, 0);
    expectNoStderr(result);
    expect(parseJsonStdout(result)).toMatchObject({
      ok: true,
      command: 'canvas.query',
      mode: 'summary',
      selector: {
        source: 'flags',
        canvasId: seeded.canvas.id,
        canvasNameQuery: null,
        filters: {
          ids: ['group-root', 'rect-1'],
          kinds: [],
          types: [],
          style: {},
          group: null,
          subtree: null,
          bounds: null,
          boundsMode: 'intersects',
        },
      },
      canvas: { id: seeded.canvas.id, name: 'query-ids-canvas', automergeUrl: seeded.canvas.automerge_url },
      count: 2,
      matches: [
        {
          metadata: {
            kind: 'group',
            id: 'group-root',
            type: null,
            parentGroupId: null,
            zIndex: 'a0',
            bounds: { x: 120, y: 240, w: 320, h: 180 },
          },
          payload: {
            kind: 'group',
            id: 'group-root',
            data: null,
            style: null,
            directChildElementIds: ['rect-1'],
            directChildGroupIds: [],
            directChildElementCount: 1,
            directChildGroupCount: 0,
          },
        },
        {
          metadata: {
            kind: 'element',
            id: 'rect-1',
            type: 'rect',
            parentGroupId: 'group-root',
            zIndex: 'a1',
            bounds: { x: 120, y: 240, w: 320, h: 180 },
          },
          payload: {
            kind: 'element',
            id: 'rect-1',
            type: 'rect',
            parentGroupId: 'group-root',
            position: { x: 120, y: 240 },
            createdAt: 1712345678000,
            updatedAt: 1712345678999,
            data: { type: 'rect', w: 320, h: 180 },
            style: { backgroundColor: '#ffffff', strokeColor: '#111111', strokeWidth: 1, opacity: 1 },
          },
        },
      ],
    });
  });

  test('filters element types and prints summary text by default', async () => {
    const context = await createContext();
    const rect = createRectElement({ id: 'rect-1', x: 10, y: 20, zIndex: 'a0', data: { w: 120, h: 80 } });
    const terminal = {
      ...createRectElement({ id: 'terminal-1', x: 300, y: 400, zIndex: 'a1' }),
      data: {
        type: 'widget',
        kind: 'terminal',
        w: 460,
        h: 300,
        expanded: true,
        window: 'contained',
        payload: { workingDirectory: '.' },
      },
    } satisfies TElement;
    const seeded = await context.seedCanvasFixture({ name: 'query-type-canvas', elements: { [rect.id]: rect, [terminal.id]: terminal } });

    const result = await context.runCanvasCli(['query', '--canvas', seeded.canvas.id, '--type', 'rect']);

    expectExitCode(result, 0);
    expectNoStderr(result);
    expect(result.stdout).toContain(`Query matched 1 target in canvas=${seeded.canvas.id} name=${JSON.stringify(seeded.canvas.name)} mode=summary`);
    expect(result.stdout).toContain('- element rect-1 [rect] parent=null bounds=(10, 20, 120, 80) z=a0 locked=false');
    expect(result.stdout).toContain('data={"h":80,"type":"rect","w":120}');
    expect(result.stdout).toContain('style={"backgroundColor":"#ffffff","opacity":1,"strokeColor":"#111111","strokeWidth":1}');
  });

  test('filters direct children with --group', async () => {
    const context = await createContext();
    const rootGroup = createGroup({ id: 'group-root', zIndex: 'a0' });
    const childGroup = createGroup({ id: 'group-child', parentGroupId: rootGroup.id, zIndex: 'a1' });
    const directElement = createRectElement({ id: 'rect-direct', parentGroupId: rootGroup.id, zIndex: 'a2' });
    const nestedElement = createRectElement({ id: 'rect-nested', parentGroupId: childGroup.id, zIndex: 'a3' });
    const seeded = await context.seedCanvasFixture({
      name: 'query-group-canvas',
      groups: { [rootGroup.id]: rootGroup, [childGroup.id]: childGroup },
      elements: { [directElement.id]: directElement, [nestedElement.id]: nestedElement },
    });

    const result = await context.runCanvasCli(['query', '--canvas', seeded.canvas.id, '--group', rootGroup.id, '--json']);

    expectExitCode(result, 0);
    expectNoStderr(result);
    expect(parseJsonStdout(result)).toMatchObject({
      ok: true,
      command: 'canvas.query',
      count: 2,
      matches: [
        { metadata: { kind: 'group', id: 'group-child', parentGroupId: 'group-root' }, payload: { data: null, style: null } },
        { metadata: { kind: 'element', id: 'rect-direct', parentGroupId: 'group-root', type: 'rect' }, payload: { data: { type: 'rect', w: 120, h: 80 }, style: { backgroundColor: '#ffffff', strokeColor: '#111111', strokeWidth: 1, opacity: 1 } } },
      ],
    });
  });

  test('filters elements by exact style values', async () => {
    const context = await createContext();
    const red = createRectElement({ id: 'rect-red', style: { backgroundColor: '#ff0000', strokeColor: '#aa0000', strokeWidth: 2, opacity: 0.8 } });
    const blue = createRectElement({ id: 'rect-blue', style: { backgroundColor: '#0000ff', strokeColor: '#0000aa', strokeWidth: 2, opacity: 0.8 } });
    const group = createGroup({ id: 'group-root' });
    const seeded = await context.seedCanvasFixture({ name: 'query-style-canvas', elements: { [red.id]: red, [blue.id]: blue }, groups: { [group.id]: group } });

    const result = await context.runCanvasCli(['query', '--canvas', seeded.canvas.id, '--style', 'backgroundColor=#ff0000', '--json']);

    expectExitCode(result, 0);
    expectNoStderr(result);
    expect(parseJsonStdout(result)).toMatchObject({
      ok: true,
      command: 'canvas.query',
      selector: {
        source: 'flags',
        filters: {
          style: { backgroundColor: '#ff0000' },
        },
      },
      count: 1,
      matches: [
        {
          metadata: { kind: 'element', id: 'rect-red', type: 'rect' },
          payload: {
            kind: 'element',
            id: 'rect-red',
            data: { type: 'rect', w: 120, h: 80 },
            style: { backgroundColor: '#ff0000', strokeColor: '#aa0000', strokeWidth: 2, opacity: 0.8 },
          },
        },
      ],
    });
  });

  test('allows omitting data and style from --json payloads', async () => {
    const context = await createContext();
    const rect = createRectElement({
      id: 'rect-omit',
      data: { w: 120, h: 80 },
      style: { backgroundColor: '#ff0000', strokeColor: '#aa0000', strokeWidth: 2, opacity: 0.8 },
    });
    const seeded = await context.seedCanvasFixture({ name: 'query-omit-json-canvas', elements: { [rect.id]: rect } });

    const result = await context.runCanvasCli([
      'query',
      '--canvas',
      seeded.canvas.id,
      '--type',
      'rect',
      '--omitdata',
      '--omitstyle',
      '--json',
    ]);

    expectExitCode(result, 0);
    expectNoStderr(result);
    const parsed = parseJsonStdout<{ matches: Array<{ payload: Record<string, unknown> }> } & Record<string, unknown>>(result);

    expect(parsed).toMatchObject({
      ok: true,
      command: 'canvas.query',
      count: 1,
      matches: [
        {
          metadata: { id: 'rect-omit', kind: 'element', type: 'rect' },
          payload: { id: 'rect-omit', kind: 'element', type: 'rect' },
        },
      ],
    });
    expect(parsed.matches[0]?.payload).not.toHaveProperty('data');
    expect(parsed.matches[0]?.payload).not.toHaveProperty('style');
  });

  test('allows omitting data and style from summary text output', async () => {
    const context = await createContext();
    const rect = createRectElement({
      id: 'rect-omit-text',
      data: { w: 120, h: 80 },
      style: { backgroundColor: '#ff0000', strokeColor: '#aa0000', strokeWidth: 2, opacity: 0.8 },
    });
    const seeded = await context.seedCanvasFixture({ name: 'query-omit-text-canvas', elements: { [rect.id]: rect } });

    const result = await context.runCanvasCli([
      'query',
      '--canvas',
      seeded.canvas.id,
      '--type',
      'rect',
      '--omitdata',
      '--omitstyle',
    ]);

    expectExitCode(result, 0);
    expectNoStderr(result);
    expect(result.stdout).toContain(`Query matched 1 target in canvas=${seeded.canvas.id} name=${JSON.stringify(seeded.canvas.name)} mode=summary`);
    expect(result.stdout).toContain('- element rect-omit-text [rect]');
    expect(result.stdout).not.toContain('data=');
    expect(result.stdout).not.toContain('style=');
  });

  test('supports subtree selection via --where and returns many matches deterministically', async () => {
    const context = await createContext();
    const rootGroup = createGroup({ id: 'group-root', zIndex: 'a0' });
    const childGroup = createGroup({ id: 'group-child', parentGroupId: rootGroup.id, zIndex: 'a1' });
    const directElement = createRectElement({ id: 'rect-direct', parentGroupId: rootGroup.id, zIndex: 'a2' });
    const nestedElement = createRectElement({ id: 'rect-nested', parentGroupId: childGroup.id, zIndex: 'a3' });
    const outsideElement = createRectElement({ id: 'rect-outside', parentGroupId: null, zIndex: 'a4' });
    const seeded = await context.seedCanvasFixture({
      name: 'query-subtree-canvas',
      groups: { [rootGroup.id]: rootGroup, [childGroup.id]: childGroup },
      elements: { [directElement.id]: directElement, [nestedElement.id]: nestedElement, [outsideElement.id]: outsideElement },
    });

    const result = await context.runCanvasCli(['query', '--canvas', seeded.canvas.id, '--where', `subtree=${rootGroup.id}`, '--json']);

    expectExitCode(result, 0);
    expectNoStderr(result);
    expect(parseJsonStdout(result)).toMatchObject({
      ok: true,
      command: 'canvas.query',
      selector: {
        source: 'where',
        filters: { subtree: 'group-root', style: {} },
      },
      count: 4,
      matches: [
        { metadata: { kind: 'group', id: 'group-root' } },
        { metadata: { kind: 'group', id: 'group-child' } },
        { metadata: { kind: 'element', id: 'rect-direct' } },
        { metadata: { kind: 'element', id: 'rect-nested' } },
      ],
    });
  });

  test('filters by computed bounds and returns zero matches stably', async () => {
    const context = await createContext();
    const inside = createRectElement({ id: 'rect-inside', x: 20, y: 30, data: { w: 100, h: 60 } });
    const outside = createRectElement({ id: 'rect-outside', x: 600, y: 700, data: { w: 90, h: 50 } });
    const seeded = await context.seedCanvasFixture({ name: 'query-bounds-canvas', elements: { [inside.id]: inside, [outside.id]: outside } });

    const insideResult = await context.runCanvasCli(['query', '--canvas', seeded.canvas.id, '--bounds', '0,0,200,200', '--json']);

    expectExitCode(insideResult, 0);
    expectNoStderr(insideResult);
    expect(parseJsonStdout(insideResult)).toMatchObject({
      ok: true,
      command: 'canvas.query',
      count: 1,
      matches: [
        { metadata: { id: 'rect-inside', kind: 'element', bounds: { x: 20, y: 30, w: 100, h: 60 } } },
      ],
    });

    const zeroResult = await context.runCanvasCli(['query', '--canvas', seeded.canvas.id, '--query', JSON.stringify({ bounds: { x: 900, y: 900, w: 50, h: 50 } }), '--json']);

    expectExitCode(zeroResult, 0);
    expectNoStderr(zeroResult);
    expect(parseJsonStdout(zeroResult)).toMatchObject({
      ok: true,
      command: 'canvas.query',
      mode: 'summary',
      selector: {
        source: 'query',
        canvasId: seeded.canvas.id,
        canvasNameQuery: null,
        filters: {
          ids: [],
          kinds: [],
          types: [],
          style: {},
          group: null,
          subtree: null,
          bounds: { x: 900, y: 900, w: 50, h: 50 },
          boundsMode: 'intersects',
        },
      },
      canvas: {
        id: seeded.canvas.id,
        name: seeded.canvas.name,
        automergeUrl: seeded.canvas.automerge_url,
        createdAt: expect.any(String),
      },
      count: 0,
      matches: [],
    });
  });

  test('rejects ambiguous selector input combinations', async () => {
    const context = await createContext();
    const seeded = await context.seedCanvasFixture({ name: 'query-conflict-canvas' });

    const result = await context.runCanvasCli([
      'query',
      '--canvas',
      seeded.canvas.id,
      '--where',
      'type=rect',
      '--query',
      JSON.stringify({ types: ['rect'] }),
      '--json',
    ]);

    expectExitCode(result, 1);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      command: 'canvas.query',
      code: 'CANVAS_QUERY_SELECTOR_CONFLICT',
      message: 'Pass at most one selector input style: structured flags, --where, or --query.',
      hint: 'Use exactly one selector style: structured flags, --where, or --query.',
      next: 'Try: vibecanvas query --canvas <canvas-id> --id <target-id> --json',
      canvasId: seeded.canvas.id,
      canvasNameQuery: null,
    });
  });

  test('rejects invalid output mode values', async () => {
    const context = await createContext();
    const rect = createRectElement({ id: 'rect-output' });
    const seeded = await context.seedCanvasFixture({ name: 'query-output-canvas', elements: { [rect.id]: rect } });

    const result = await context.runCanvasCli(['query', '--canvas', seeded.canvas.id, '--id', rect.id, '--output', 'potato', '--json']);

    expectExitCode(result, 1);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      command: 'canvas.query',
      code: 'CANVAS_QUERY_OUTPUT_INVALID',
      hint: 'Use one of the documented output modes only.',
    });
  });

  test('rejects invalid --query json shapes instead of falling back to match-all', async () => {
    const context = await createContext();
    const rect = createRectElement({ id: 'rect-query-json' });
    const seeded = await context.seedCanvasFixture({ name: 'query-json-canvas', elements: { [rect.id]: rect } });

    const result = await context.runCanvasCli(['query', '--canvas', seeded.canvas.id, '--query', '[]', '--json']);

    expectExitCode(result, 1);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      command: 'canvas.query',
      code: 'CANVAS_QUERY_JSON_INVALID',
      hint: '--query must be a JSON object with known selector fields.',
    });
  });

  test('blind agent can reach query then patch from help and error hints alone', async () => {
    const context = await createContext();
    const rect = createRectElement({ id: 'rect-blind', x: 10, y: 20 });
    const seeded = await context.seedCanvasFixture({ name: 'blind-agent-canvas', elements: { [rect.id]: rect } });

    const rootHelp = await context.runVibecanvasCli(['--help']);
    expectExitCode(rootHelp, 0);
    expect(rootHelp.stdout).toContain('Help ladder:');
    expect(rootHelp.stdout).toContain('vibecanvas query --help');

    const patchHelp = await context.runVibecanvasCli(['patch', '--help']);
    expectExitCode(patchHelp, 0);
    expect(patchHelp.stdout).toContain('Patch envelope:');
    expect(patchHelp.stdout).toContain('{"element":{...}}');

    const wrongPatch = await context.runVibecanvasCli(['patch', '--canvas', seeded.canvas.id, '--id', rect.id, '--patch', '{"locked":true}', '--json', '--db', context.dbPath]);
    expectExitCode(wrongPatch, 1);
    expect(JSON.parse(wrongPatch.stderr)).toMatchObject({
      code: 'CANVAS_PATCH_PAYLOAD_INVALID',
      hint: 'Patch payload must use one top-level envelope: {"element":{...}} for elements or {"group":{...}} for groups.',
    });

    const query = await context.runVibecanvasCli(['query', '--canvas', seeded.canvas.id, '--id', rect.id, '--json', '--db', context.dbPath]);
    expectExitCode(query, 0);
    expect(parseJsonStdout<{ ok: boolean; command: string; count: number }>(query)).toMatchObject({ ok: true, command: 'canvas.query', count: 1 });

    const patch = await context.runVibecanvasCli(['patch', '--canvas', seeded.canvas.id, '--id', rect.id, '--patch', '{"element":{"x":99}}', '--json', '--db', context.dbPath]);
    expectExitCode(patch, 0);
    expect(parseJsonStdout<{ ok: boolean; command: string; changedCount: number }>(patch)).toMatchObject({ ok: true, command: 'canvas.patch', changedCount: 1 });
  });
});
