import { describe, expect, it, vi } from "vitest";
import { createCatalogInvalidation } from "../../../src/shell/framework/feature/sidebar/ports";

describe("catalog invalidation", () => {
  it("notifies only the requested catalog and unsubscribes cleanly", () => {
    const invalidation = createCatalogInvalidation();
    const resources = vi.fn();
    const widgets = vi.fn();
    const unsubscribeResources = invalidation.subscribe("resources", resources);
    invalidation.subscribe("widgets", widgets);

    invalidation.invalidate("resources");
    expect(resources).toHaveBeenCalledOnce();
    expect(widgets).not.toHaveBeenCalled();

    unsubscribeResources();
    invalidation.invalidate("resources");
    expect(resources).toHaveBeenCalledOnce();
  });
});
