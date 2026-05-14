import { describe, expect, it } from "vitest";
import { normalizeBaseUrl } from "../../src/config.js";

describe("config URL normalization", () => {
  it("removes trailing slash and path noise from debugger URL", () => {
    expect(normalizeBaseUrl("http://127.0.0.1:19999///?x=1#hash")).toBe("http://127.0.0.1:19999");
  });
});
