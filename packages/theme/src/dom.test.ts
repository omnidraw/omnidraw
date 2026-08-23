import { describe, expect, test } from "bun:test";
import {
  BUILTIN_THEMES,
  OMNIDRAW_THEME_APPEARANCE_ATTRIBUTE,
  OMNIDRAW_THEME_DARK_CLASS,
  OMNIDRAW_THEME_ID_ATTRIBUTE,
  OMNIDRAW_THEME_SCOPE_ATTRIBUTE,
  applyThemeToElement,
  fnThemeCssRule,
} from "./index";

function fakeElement(scoped: boolean) {
  const attributes = new Map<string, string>();
  const styles = new Map<string, string>();
  const classes = new Set<string>();
  if (scoped) attributes.set(OMNIDRAW_THEME_SCOPE_ATTRIBUTE, "test");
  const element = {
    hasAttribute(name: string) {
      return attributes.has(name);
    },
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    style: {
      colorScheme: "",
      setProperty(name: string, value: string) {
        styles.set(name, value);
      },
    },
    classList: {
      toggle(name: string, force?: boolean) {
        const present = force ?? !classes.has(name);
        if (present) classes.add(name);
        else classes.delete(name);
        return present;
      },
    },
  } as unknown as HTMLElement;
  return { attributes, classes, element, styles };
}

describe("scoped theme DOM projection", () => {
  test("rejects an unmarked element before mutating it", () => {
    const host = fakeElement(false);
    expect(() => applyThemeToElement(host.element, BUILTIN_THEMES[0]!))
      .toThrow(OMNIDRAW_THEME_SCOPE_ATTRIBUTE);
    expect(host.attributes.size).toBe(0);
    expect(host.styles.size).toBe(0);
  });

  test("mutates only the supplied marked scope", () => {
    const first = fakeElement(true);
    const second = fakeElement(true);
    applyThemeToElement(first.element, BUILTIN_THEMES[1]!);

    expect(first.styles.get("--omnidraw-background")).toBe("#0c0a09");
    expect(first.attributes.get(OMNIDRAW_THEME_ID_ATTRIBUTE)).toBe("dark");
    expect(first.attributes.get(OMNIDRAW_THEME_APPEARANCE_ATTRIBUTE))
      .toBe("dark");
    expect(first.classes.has(OMNIDRAW_THEME_DARK_CLASS)).toBe(true);
    expect(second.styles.size).toBe(0);
    expect(second.attributes.has(OMNIDRAW_THEME_ID_ATTRIBUTE)).toBe(false);

    applyThemeToElement(first.element, BUILTIN_THEMES[0]!);
    expect(first.classes.has(OMNIDRAW_THEME_DARK_CLASS)).toBe(false);
  });

  test("generates only a scoped, namespaced default rule", () => {
    const css = fnThemeCssRule(BUILTIN_THEMES[0]!);
    expect(css.startsWith(`[${OMNIDRAW_THEME_SCOPE_ATTRIBUTE}] {`)).toBe(true);
    expect(css).toContain("--omnidraw-background: #fafaf9;");
    expect(css).not.toContain(":root");
    expect(css).not.toContain("--background:");
    expect(css).not.toContain("--vc-");
    expect(css).not.toContain("--preview-");
  });
});
