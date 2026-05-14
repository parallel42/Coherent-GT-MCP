import { describe, expect, it } from "vitest";
import { loadConfig, normalizeBaseUrl } from "../../src/config.js";

describe("config URL normalization", () => {
  it("removes trailing slash and path noise from debugger URL", () => {
    expect(normalizeBaseUrl("http://127.0.0.1:19999///?x=1#hash")).toBe("http://127.0.0.1:19999");
  });

  it("defaults idle shutdown to 50 minutes", () => {
    expect(loadConfig({}).idleTimeoutMs).toBe(3000000);
  });

  it("defaults websocket commands to 30 seconds", () => {
    expect(loadConfig({}).wsTimeoutMs).toBe(30000);
  });

  it("allows disabling idle shutdown", () => {
    expect(loadConfig({ COHERENT_GT_IDLE_TIMEOUT_MS: "0" }).idleTimeoutMs).toBe(0);
  });
});
