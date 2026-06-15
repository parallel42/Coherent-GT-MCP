import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
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

  it("keeps Codex stdio open and restarts the child MCP server after a child exit", async () => {
    const tempRoot = join(tmpdir(), `coherentgt-launcher-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(tempRoot, { recursive: true });
    const statePath = join(tempRoot, "state.json");
    const childPath = join(tempRoot, "fake-child.mjs");
    writeFileSync(
      childPath,
      `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const statePath = process.env.FAKE_CHILD_STATE;
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { starts: 0 };
state.starts += 1;
writeFileSync(statePath, JSON.stringify(state));

let initialized = false;
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake", version: "0" } } }) + "\\n");
    return;
  }
  if (message.method === "notifications/initialized") {
    initialized = true;
    return;
  }
  if (message.id === 2 && state.starts === 1) {
    process.exit(42);
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { initialized, starts: state.starts } }) + "\\n");
});
`,
      "utf8"
    );

    const launcher = spawn(process.execPath, [fileURLToPath(new URL("../../scripts/codex-shared-mcp-proxy.mjs", import.meta.url))], {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: {
        ...process.env,
        COHERENT_GT_SUPERVISED_ENTRY: childPath,
        FAKE_CHILD_STATE: statePath
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    const stderr: string[] = [];
    launcher.stderr.setEncoding("utf8");
    launcher.stderr.on("data", (chunk) => stderr.push(chunk));

    const output = createInterface({ input: launcher.stdout });
    const nextMessage = (): Promise<Record<string, unknown>> =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timed out waiting for launcher output. stderr=${stderr.join("")}`)), 2000);
        output.once("line", (line) => {
          clearTimeout(timeout);
          resolve(JSON.parse(line) as Record<string, unknown>);
        });
      });

    try {
      launcher.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
      await expect(nextMessage()).resolves.toMatchObject({ id: 1, result: { serverInfo: { name: "fake" } } });
      launcher.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

      launcher.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {} }) + "\n");
      await expect(nextMessage()).resolves.toMatchObject({ id: 2, error: { code: -32000 } });

      launcher.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: {} }) + "\n");
      await expect(nextMessage()).resolves.toMatchObject({ id: 3, result: { initialized: true, starts: 2 } });
    } finally {
      output.close();
      launcher.kill();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
