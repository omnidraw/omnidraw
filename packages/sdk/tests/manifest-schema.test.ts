import { describe, expect, test } from 'bun:test';
import manifestSchema from '../vibecanvas.schema.json';

describe('public actor manifest schema', () => {
  test('defines schema-agnostic database resource slots', () => {
    const requirement = manifestSchema.$defs.dbResourceRequirement;

    expect(requirement.required).toEqual(['kind', 'required', 'scope']);
    expect(requirement.properties).not.toHaveProperty('schema');
    expect(requirement.additionalProperties).toBe(false);
  });
});
