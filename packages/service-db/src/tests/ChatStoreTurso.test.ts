import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DbServiceTurso } from '../DbServiceTurso/DbServiceTurso';

const CANVAS_ID = 'chat-canvas';
const CHAT_ID = 'chat-a';
const TIMESTAMP_SEC = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

describe('filesystem-first chat metadata store', () => {
  let service: DbServiceTurso;

  beforeEach(async () => {
    service = new DbServiceTurso({ databasePath: ':memory:', dataDir: '/tmp', cacheDir: '/tmp' });
    await service.start();
    await service.canvas.create({ id: CANVAS_ID, name: 'Chat canvas' });
  });

  afterEach(async () => {
    await service.stop();
  });

  test('creates, gets, lists, updates, and archives retained metadata', async () => {
    const created = await service.chats.create({
      id: CHAT_ID,
      canvasId: CANVAS_ID,
      name: 'First chat',
      workspaceRelativePath: 'widgets/counter/chats/chat-a',
      historyRelativePath: 'agent/history/chat-a.jsonl',
    });
    expect(created).toEqual({
      id: CHAT_ID,
      canvasId: CANVAS_ID,
      name: 'First chat',
      status: 'active',
      workspaceRelativePath: 'widgets/counter/chats/chat-a',
      historyRelativePath: 'agent/history/chat-a.jsonl',
      createdAtSec: expect.stringMatching(TIMESTAMP_SEC),
      updatedAtSec: expect.stringMatching(TIMESTAMP_SEC),
    });
    expect(await service.chats.get({ id: CHAT_ID })).toEqual(created);
    expect(await service.chats.list({ canvasId: CANVAS_ID, status: 'active' })).toEqual([created]);

    const renamed = await service.chats.update({ id: CHAT_ID, name: 'Renamed chat' });
    expect(renamed).toMatchObject({ id: CHAT_ID, name: 'Renamed chat', status: 'active' });
    expect(await service.chats.archive({ id: CHAT_ID })).toMatchObject({
      id: CHAT_ID,
      name: 'Renamed chat',
      status: 'archived',
    });
    expect(await service.chats.list({ status: 'active' })).toEqual([]);
    expect(await service.chats.list({ status: 'archived' })).toHaveLength(1);
  });

  test('enforces canvas references and unique workspace/history paths', async () => {
    await service.chats.create({
      id: CHAT_ID,
      canvasId: CANVAS_ID,
      name: 'First chat',
      workspaceRelativePath: 'widgets/counter/chats/chat-a',
      historyRelativePath: 'agent/history/chat-a.jsonl',
    });
    await expect(service.chats.create({
      id: 'chat-duplicate-workspace',
      canvasId: null,
      name: 'Duplicate workspace',
      workspaceRelativePath: 'widgets/counter/chats/chat-a',
      historyRelativePath: 'agent/history/chat-b.jsonl',
    })).rejects.toThrow();
    await expect(service.chats.create({
      id: 'chat-duplicate-history',
      canvasId: null,
      name: 'Duplicate history',
      workspaceRelativePath: 'widgets/counter/chats/chat-b',
      historyRelativePath: 'agent/history/chat-a.jsonl',
    })).rejects.toThrow();
    await expect(service.chats.create({
      id: 'chat-missing-canvas',
      canvasId: 'missing-canvas',
      name: 'Missing canvas',
      workspaceRelativePath: 'widgets/counter/chats/chat-c',
      historyRelativePath: 'agent/history/chat-c.jsonl',
    })).rejects.toThrow();
  });

  test('retains chat history by restricting deletion of its referenced canvas', async () => {
    await service.chats.create({
      id: CHAT_ID,
      canvasId: CANVAS_ID,
      name: 'First chat',
      workspaceRelativePath: 'widgets/counter/chats/chat-a',
      historyRelativePath: 'agent/history/chat-a.jsonl',
    });
    await expect(service.canvas.deleteById({ id: CANVAS_ID })).rejects.toThrow();
    expect(await service.chats.get({ id: CHAT_ID })).not.toBeNull();
    expect(await service.canvas.findById({ id: CANVAS_ID })).not.toBeNull();
  });

  test('allows metadata with no canvas association', async () => {
    const created = await service.chats.create({
      id: 'chat-global',
      canvasId: null,
      name: 'Global chat',
      workspaceRelativePath: 'widgets/global/chats/chat',
      historyRelativePath: 'agent/history/chat-global.jsonl',
    });
    expect(created.canvasId).toBeNull();
    expect(await service.chats.list({ canvasId: null })).toEqual([created]);
  });
});
