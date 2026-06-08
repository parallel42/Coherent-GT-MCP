import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Codex stdio launcher", () => {
  it("forces stdio transport even when the parent environment is configured for HTTP", () => {
    const launcher = readFileSync(new URL("../../scripts/codex-shared-mcp-proxy.mjs", import.meta.url), "utf8");

    expect(launcher).toContain('process.env.COHERENT_GT_TRANSPORT = "stdio";');
    expect(launcher).not.toContain("process.env.COHERENT_GT_TRANSPORT ??=");
  });

  it("defaults idle shutdown off for Codex-managed stdio processes", () => {
    const launcher = readFileSync(new URL("../../scripts/codex-shared-mcp-proxy.mjs", import.meta.url), "utf8");

    expect(launcher).toContain('process.env.COHERENT_GT_IDLE_TIMEOUT_MS ??= "0";');
  });
});
