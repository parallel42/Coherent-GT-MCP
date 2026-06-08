#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(scriptDir, "..", "dist", "index.js");

// Codex starts this launcher as a stdio MCP server, so do not inherit HTTP mode from a shell.
process.env.COHERENT_GT_TRANSPORT = "stdio";
process.env.COHERENT_GT_DEBUGGER_URL ??= "http://127.0.0.1:19999";
process.env.COHERENT_GT_IDLE_TIMEOUT_MS ??= "0";

if (!existsSync(serverEntry)) {
  console.error(`coherent-gt-mcp build output not found: ${serverEntry}`);
  console.error("Run npm run build before starting the Codex MCP launcher.");
  process.exit(1);
}

await import(pathToFileURL(serverEntry).href);
