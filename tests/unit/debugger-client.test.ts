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

  it("defaults to stdio transport and normalizes HTTP settings", () => {
    expect(
      loadConfig({
        COHERENT_GT_TRANSPORT: "http",
        COHERENT_GT_HTTP_HOST: "127.0.0.1",
        COHERENT_GT_HTTP_PORT: "3337",
        COHERENT_GT_HTTP_PATH: "mcp"
      })
    ).toMatchObject({
      transport: "http",
      httpHost: "127.0.0.1",
      httpPort: 3337,
      httpPath: "/mcp"
    });
  });

  it("loads host helper settings for Docker host correlation", () => {
    expect(
      loadConfig({
        COHERENT_GT_HOST_HELPER_URL: "http://127.0.0.1:3344/",
        COHERENT_GT_HOST_HELPER_PROCESS_NAMES: "CoherentHost, CoherentRuntime",
        COHERENT_GT_HOST_HELPER_LOG_ROOTS: "C:\\Logs|D:\\Logs",
        COHERENT_GT_HOST_HELPER_RESOURCE_ROOTS: "C:\\CoherentResources|D:\\CoherentResources"
      })
    ).toMatchObject({
      hostHelperUrl: "http://127.0.0.1:3344",
      hostHelperProcessNames: ["CoherentHost", "CoherentRuntime"],
      hostHelperLogRoots: ["C:\\Logs", "D:\\Logs"],
      hostHelperResourceRoots: ["C:\\CoherentResources", "D:\\CoherentResources"]
    });
  });

  it("allows disabling idle shutdown", () => {
    expect(loadConfig({ COHERENT_GT_IDLE_TIMEOUT_MS: "0" }).idleTimeoutMs).toBe(0);
  });
});
