#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const containerName = process.env.COHERENT_GT_SHARED_CONTAINER_NAME ?? "coherent-gt-mcp-shared";
const image = process.env.COHERENT_GT_SHARED_IMAGE ?? "p42-coherentgt-mcp:latest";
const httpPort = process.env.COHERENT_GT_SHARED_HTTP_PORT ?? "3333";
const mcpUrl = process.env.COHERENT_GT_SHARED_MCP_URL ?? `http://127.0.0.1:${httpPort}/mcp`;
const healthUrl = process.env.COHERENT_GT_SHARED_HEALTH_URL ?? `http://127.0.0.1:${httpPort}/health`;
const debuggerUrl = process.env.COHERENT_GT_DEBUGGER_URL ?? "http://host.docker.internal:19999";
const idleTimeoutMs = process.env.COHERENT_GT_IDLE_TIMEOUT_MS;

let upstreamClient;
let upstreamTransport;
let upstreamConnecting;
let shuttingDown = false;

const server = new Server(
  {
    name: "coherent-gt-shared-docker-proxy",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  return await withUpstream((client) => client.listTools(request.params));
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return await withUpstream((client) => client.callTool(request.params));
});

const stdio = new StdioServerTransport();
stdio.onerror = (error) => {
  log(`stdio transport error: ${errorMessage(error)}`);
};

process.on("SIGINT", () => {
  shutdown(0).catch((error) => {
    log(`shutdown error: ${errorMessage(error)}`);
    process.exit(1);
  });
});
process.on("SIGTERM", () => {
  shutdown(0).catch((error) => {
    log(`shutdown error: ${errorMessage(error)}`);
    process.exit(1);
  });
});
process.stdin.on("end", () => {
  shutdown(0).catch((error) => {
    log(`shutdown error: ${errorMessage(error)}`);
    process.exit(1);
  });
});
process.stdin.on("close", () => {
  shutdown(0).catch((error) => {
    log(`shutdown error: ${errorMessage(error)}`);
    process.exit(1);
  });
});

await server.connect(stdio);

async function withUpstream(fn) {
  try {
    return await fn(await getUpstreamClient());
  } catch (error) {
    log(`upstream request failed; reconnecting once: ${errorMessage(error)}`);
    await closeUpstream();
    return await fn(await getUpstreamClient());
  }
}

async function getUpstreamClient() {
  if (upstreamClient) {
    await ensureSharedContainer();
    return upstreamClient;
  }

  if (!upstreamConnecting) {
    upstreamConnecting = connectUpstream().finally(() => {
      upstreamConnecting = undefined;
    });
  }

  return await upstreamConnecting;
}

async function connectUpstream() {
  await ensureSharedContainer();

  const client = new Client({
    name: "coherent-gt-shared-docker-proxy-upstream",
    version: "0.1.0"
  });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
  transport.onerror = (error) => {
    log(`HTTP MCP transport error: ${errorMessage(error)}`);
  };
  transport.onclose = () => {
    upstreamClient = undefined;
    upstreamTransport = undefined;
  };

  await client.connect(transport);
  upstreamClient = client;
  upstreamTransport = transport;
  return client;
}

async function closeUpstream() {
  const client = upstreamClient;
  const transport = upstreamTransport;
  upstreamClient = undefined;
  upstreamTransport = undefined;
  if (typeof transport?.terminateSession === "function") {
    await transport.terminateSession().catch((error) => {
      log(`upstream session termination error: ${errorMessage(error)}`);
    });
  }
  if (client) {
    await client.close().catch((error) => {
      log(`upstream close error: ${errorMessage(error)}`);
    });
  } else if (transport) {
    await transport.close().catch((error) => {
      log(`upstream transport close error: ${errorMessage(error)}`);
    });
  }
}

async function ensureSharedContainer() {
  const state = inspectContainer();
  if (state === "running") {
    await waitForHealth();
    return;
  }

  if (state === "missing") {
    createContainer();
  } else {
    startContainer();
  }

  await waitForHealth();
}

function inspectContainer() {
  const result = docker(["inspect", "--format", "{{.State.Status}}", containerName], { check: false });
  if (result.status !== 0) {
    return "missing";
  }

  return result.stdout.trim() === "running" ? "running" : "stopped";
}

function createContainer() {
  const args = [
    "run",
    "-d",
    "--name",
    containerName,
    "-p",
    `${httpPort}:3333`,
    "-e",
    "COHERENT_GT_TRANSPORT=http",
    "-e",
    `COHERENT_GT_DEBUGGER_URL=${debuggerUrl}`
  ];

  if (idleTimeoutMs !== undefined && idleTimeoutMs.trim() !== "") {
    args.push("-e", `COHERENT_GT_IDLE_TIMEOUT_MS=${idleTimeoutMs}`);
  }

  args.push(image);

  const result = docker(args, { check: false });
  if (result.status === 0) {
    return;
  }

  const state = inspectContainer();
  if (state === "running") {
    return;
  }
  if (state === "stopped") {
    startContainer();
    return;
  }

  throw new Error(`Failed to create shared MCP container: ${result.stderr || result.stdout}`);
}

function startContainer() {
  const result = docker(["start", containerName], { check: false });
  if (result.status === 0 || inspectContainer() === "running") {
    return;
  }

  throw new Error(`Failed to start shared MCP container: ${result.stderr || result.stdout}`);
}

async function waitForHealth() {
  const started = Date.now();
  let lastError = "";

  while (Date.now() - started < 30000) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = errorMessage(error);
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for shared MCP health at ${healthUrl}: ${lastError}`);
}

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    windowsHide: true
  });

  if (options.check && result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

async function shutdown(code) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  await closeUpstream();
  await server.close();
  process.exit(code);
}

function log(message) {
  console.error(`[coherent-gt-shared-proxy] ${message}`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
