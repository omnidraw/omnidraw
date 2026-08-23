import { describe, expect, test } from 'bun:test';
import {
  CANVAS_SCENE_SCHEMA_VERSION,
  CanvasCommandCodec,
  CanvasDocumentCodec,
} from '@omnidraw/canvas-contract';
import { PrivateProcedure, PrivateProcedureContract, parseProcedureInput, parseProcedureOutput } from './procedure';

describe('private procedure object codecs', () => {
  test('uses decode for object-valued codec input and output', () => {
    const command = {
      commandId: 'command-1',
      canvasId: 'canvas-1',
      baseRevision: 0,
      operations: [{
        type: 'insert' as const,
        item: {
          id: 'rect-1', kind: 'rect' as const, parentId: null, orderKey: 'a0',
          transform: {
            position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 },
            skew: { x: 0, y: 0 }, origin: { x: 0, y: 0 },
          },
          size: { width: 10, height: 10 },
        },
      }],
      preconditions: [],
    };
    const snapshot = {
      schemaVersion: CANVAS_SCENE_SCHEMA_VERSION,
      canvasId: 'canvas-1',
      revision: 0,
      items: [],
    };
    const procedure = new PrivateProcedure(
      new PrivateProcedureContract().input(CanvasCommandCodec).output(CanvasDocumentCodec),
      async () => snapshot,
    );
    expect(parseProcedureInput(procedure, command)).toEqual(command);
    expect(parseProcedureOutput(procedure, snapshot)).toEqual(snapshot);
    expect(() => parseProcedureInput(procedure, { ...command, operations: [] })).toThrow();
    expect(() => parseProcedureOutput(procedure, { ...snapshot, schemaVersion: 'old' })).toThrow();
  });
});
