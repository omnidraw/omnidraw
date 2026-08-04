import { describe, expect, test } from 'bun:test';
import { apiWidgetPlacementResolve } from './api.placement-resolve';

const reference = Object.freeze({
  source: 'published' as const,
  widgetKey: 'counter',
  catalogGeneration: 7,
});

const resourceBindings = Object.freeze({
  todos: Object.freeze({
    resourceId: 'resource-a',
    allowRead: true,
    allowWrite: false,
  }),
});

describe('filesystem widget placement API', () => {
  test('delegates the exact catalog reference and concrete local resource choices', async () => {
    const calls: unknown[] = [];
    const descriptor = Object.freeze({
      kind: 'published' as const,
      reference,
      widgetKey: reference.widgetKey,
      catalogGeneration: reference.catalogGeneration,
      bounds: Object.freeze({ width: 480, height: 320 }),
      resourceBindings,
    });
    const context = {
      widgetCatalog: {
        resolvePlacement(input: unknown) {
          calls.push(input);
          return descriptor;
        },
      },
    } as never;
    const resolvePlacement = apiWidgetPlacementResolve.callable({ context });

    await expect(resolvePlacement({ reference, resourceBindings })).resolves.toEqual(descriptor);
    expect(calls).toEqual([{ reference, resourceBindings }]);
  });

  test('maps stale, missing, and invalid resource selections to stable public errors', async () => {
    const cases = [
      ['WIDGET_CATALOG_CHANGED', 'CONFLICT'],
      ['WIDGET_MISSING', 'NOT_FOUND'],
      ['WIDGET_CATALOG_NOT_READY', 'NOT_FOUND'],
      ['WIDGET_RESOURCE_SELECTION_REQUIRED', 'BAD_REQUEST'],
      ['WIDGET_RESOURCE_SELECTION_INVALID', 'BAD_REQUEST'],
    ] as const;

    for (const [domainCode, apiCode] of cases) {
      const context = {
        widgetCatalog: {
          resolvePlacement() {
            throw Object.assign(new Error(`catalog failure: ${domainCode}`), {
              code: domainCode,
            });
          },
        },
      } as never;
      const resolvePlacement = apiWidgetPlacementResolve.callable({ context });

      try {
        await resolvePlacement({ reference, resourceBindings });
        throw new Error('Expected widget placement rejection.');
      } catch (error) {
        expect(error).toMatchObject({ code: apiCode });
        if (apiCode === 'BAD_REQUEST') {
          expect(error).toMatchObject({ message: `catalog failure: ${domainCode}` });
        }
      }
    }
  });
});
