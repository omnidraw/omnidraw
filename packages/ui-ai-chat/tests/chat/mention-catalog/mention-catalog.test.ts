import type { TWidgetPublicCatalog } from '@omnidraw/orpc-client';
import { describe, expect, it, vi } from 'vitest';
import {
  refreshMentionCatalog,
  subscribeMentionCatalog,
} from '../../../src/chat/mention-catalog';
import { publicCatalog } from '../../widget-public-catalog.fixture';

describe('shared mention catalog', () => {
  it('updates every subscriber from one live filesystem catalog refresh', async () => {
    let resourceName = 'Notes';
    let catalog: TWidgetPublicCatalog = publicCatalog([]);
    const listResources = vi.fn(async () => [undefined, [{
      id: 'db-1',
      kind: 'db',
      name: resourceName,
      status: 'ready',
    }]] as const);
    const listWidgets = vi.fn(async () => [undefined, catalog] as const);
    const api = {
      api: {
        resource: { resources: { list: listResources } },
        widget: { catalog: { get: listWidgets } },
      },
    } as never;
    const first: string[][] = [];
    const second: string[][] = [];
    const unsubscribeFirst = subscribeMentionCatalog(api, (snapshot) => {
      first.push(snapshot.mentions.map((mention) => mention.label));
    });
    const unsubscribeSecond = subscribeMentionCatalog(api, (snapshot) => {
      second.push(snapshot.mentions.map((mention) => mention.label));
    });

    await vi.waitFor(() => expect(first.at(-1)).toEqual(['Notes']));
    expect(second.at(-1)).toEqual(['Notes']);
    expect(listResources).toHaveBeenCalledTimes(1);
    expect(listWidgets).toHaveBeenCalledTimes(1);

    resourceName = 'Renamed notes';
    catalog = { ...publicCatalog([]), generation: 2 };
    await refreshMentionCatalog(api);

    expect(first.at(-1)).toEqual(['Renamed notes']);
    expect(second.at(-1)).toEqual(['Renamed notes']);
    unsubscribeFirst();
    unsubscribeSecond();
  });
});
