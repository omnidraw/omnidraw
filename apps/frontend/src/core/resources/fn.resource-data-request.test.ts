import { describe, expect, test } from "bun:test";
import { fnResourceDataRequest } from "./fn.resource-data-request";

describe("resource data request projection", () => {
  test("omits absent optional filters from the JSON transport input", () => {
    const request = fnResourceDataRequest({
      resourceId: "resource-1",
      prefix: "",
      limit: 50,
    });

    expect(request).toEqual({ resourceId: "resource-1", limit: 50 });
    expect(JSON.parse(JSON.stringify(request))).toEqual(request);
  });

  test("retains explicit prefix and cursor filters", () => {
    expect(fnResourceDataRequest({
      resourceId: "resource-1",
      prefix: "settings/",
      cursor: "cursor-1",
      limit: 50,
    })).toEqual({
      resourceId: "resource-1",
      prefix: "settings/",
      cursor: "cursor-1",
      limit: 50,
    });
  });
});
