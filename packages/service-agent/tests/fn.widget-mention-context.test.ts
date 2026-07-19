import { describe, expect, test } from 'bun:test';
import { fnWidgetMentionContext } from '../src/core/fn.widget-mention-context';

describe("widget mention prompt context", () => {
  test("keeps exact widget identity and source in trusted prompt metadata", () => {
    const context = fnWidgetMentionContext({
      widgets: [{ name: "Weather", source: "draft", displayName: "Weather dashboard", revision: "rev-2" }],
    });
    expect(context).toContain('"name":"Weather"');
    expect(context).toContain('"source":"draft"');
    expect(context).toContain('"revision":"rev-2"');
  });

  test("does not change prompts without widget targets", () => {
    expect(fnWidgetMentionContext({ widgets: [] })).toBe('');
  });
});
