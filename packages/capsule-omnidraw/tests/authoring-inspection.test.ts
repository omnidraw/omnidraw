import { describe, expect, test } from 'bun:test';
import {
  CAPSULE_AUTHORING_INSPECTION_LIMITS,
  createOmnidrawCapsuleAuthoringInspection,
  createOmnidrawCapsuleAuthoringInspectionHost,
} from '../src/authoring-inspection';

describe('Omnidraw Capsule authoring-inspection adapter', () => {
  test('exposes the dedicated public facade with lowerable hard bounds', () => {
    expect(typeof createOmnidrawCapsuleAuthoringInspectionHost).toBe('function');
    expect(CAPSULE_AUTHORING_INSPECTION_LIMITS).toEqual(expect.objectContaining({
      maxTargets: 128,
      maxScannedElements: 4_096,
      maxSummaryResults: 128,
      maxCanvases: 16,
    }));

    const inspection = createOmnidrawCapsuleAuthoringInspection({
      maxTargets: 2,
      maxScannedElements: 8,
      maxResults: 2,
      maxSummaryResults: 2,
      maxCanvases: 1,
    });
    expect(Object.isFrozen(inspection)).toBe(true);
    expect(Object.isFrozen(inspection.attachment)).toBe(true);
    expect(typeof inspection.validateFocusedTarget).toBe('function');
    expect(typeof inspection.armNativeKeyboardGuard).toBe('function');
    expect(typeof inspection.finishNativeKeyboardGuard).toBe('function');
    expect(inspection.attachment).toMatchObject({
      kind: 'capsule-authoring-inspection-v1',
    });
    expect(inspection.diagnostics()).toEqual({
      state: 'fresh',
      attachmentGeneration: 0,
      targets: 0,
      queries: 0,
      visibleSummaries: 0,
      canvasQueries: 0,
      scannedElements: 0,
      lastQueryOmitted: 0,
      lastVisibleSummaryOmitted: 0,
      lastCanvasOmitted: 0,
      failures: 0,
    });

    expect(() => inspection.query({ css: 'button' })).toThrow(
      'Capsule authoring inspection is not bound.',
    );
    inspection.dispose();
    expect(inspection.diagnostics()).toMatchObject({
      state: 'disposed',
      targets: 0,
      scannedElements: 0,
    });
    expect(() => inspection.query({ css: 'button' })).toThrow(
      'Capsule authoring inspection is disposed.',
    );
  });

  test('cannot raise upstream hard ceilings', () => {
    expect(() => createOmnidrawCapsuleAuthoringInspection({
      maxTargets: CAPSULE_AUTHORING_INSPECTION_LIMITS.maxTargets + 1,
    })).toThrow();
  });
});
