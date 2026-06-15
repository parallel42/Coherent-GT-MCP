#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultServerEntry = resolve(scriptDir, "..", "dist", "index.js");
const serverEntry = process.env.COHERENT_GT_SUPERVISED_ENTRY || defaultServerEntry;

// Codex starts this launcher as a stdio MCP server, so do not inherit HTTP mode from a shell.
process.env.COHERENT_GT_TRANSPORT = "stdio";
process.env.COHERENT_GT_DEBUGGER_URL ??= "http://127.0.0.1:19999";
process.env.COHERENT_GT_IDLE_TIMEOUT_MS ??= "0";

if (!existsSync(serverEntry)) {
  console.error(`coherent-gt-mcp build output not found: ${serverEntry}`);
  console.error("Run npm run build before starting the Codex MCP launcher.");
  process.exit(1);
}

let child;
let childInitialized = false;
let replayInitializePromise;
let replayInitializeResolve;
let replayInitializeReject;
let cachedInitialize;
let cachedInitializedNotification;
let clientQueue = Promise.resolve();
let shuttingDown = false;

const pendingRequests = new Map();

const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  clientQueue = clientQueue
    .then(() => handleClientLine(line))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
    });
});

input.on("close", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function handleClientLine(line) {
  const message = parseJsonLine(line);
  if (!message) {
    return;
  }

  if (message.method === "initialize" && message.id !== undefined) {
    cachedInitialize = { message, line: serialize(message) };
    ensureChild();
    forwardToChild(cachedInitialize.line);
    rememberPending(message);
    return;
  }

  if (message.method === "notifications/initialized") {
    cachedInitializedNotification = { message, line: serialize(message) };
    if (child) {
      forwardToChild(cachedInitializedNotification.line);
    }
    return;
  }

  await ensureInitializedChild();
  rememberPending(message);
  forwardToChild(serialize(message));
}

async function ensureInitializedChild() {
  ensureChild();
  if (!cachedInitialize) {
    return;
  }

  await replayInitialization();
}

function ensureChild() {
  if (child && !child.killed) {
    return;
  }

  const childEnv = { ...process.env };
  childEnv.COHERENT_GT_TRANSPORT = "stdio";
  childEnv.COHERENT_GT_IDLE_TIMEOUT_MS ??= "0";

  child = spawn(process.execPath, [serverEntry], {
    cwd: resolve(scriptDir, ".."),
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"]
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  const output = createInterface({ input: child.stdout });
  output.on("line", handleChildLine);

  child.on("error", (error) => {
    rejectReplay(error);
    rejectPendingRequests(`coherent-gt-mcp child failed: ${error.message}`);
    childInitialized = false;
    child = undefined;
  });

  child.on("exit", (code, signal) => {
    const reason = signal ? `signal ${signal}` : `exit code ${code}`;
    if (!shuttingDown) {
      console.error(`coherent-gt-mcp child exited with ${reason}; the Codex stdio supervisor will restart it on the next request.`);
    }
    rejectReplay(new Error(`coherent-gt-mcp child exited with ${reason}`));
    rejectPendingRequests(`coherent-gt-mcp child exited with ${reason}; retry the MCP request`);
    childInitialized = false;
    child = undefined;
  });
}

async function replayInitialization() {
  if (!child || !cachedInitialize || childInitialized) {
    return;
  }

  if (replayInitializePromise) {
    await replayInitializePromise;
    return;
  }

  replayInitializePromise = new Promise((resolveReplay, rejectReplayPromise) => {
    replayInitializeResolve = resolveReplay;
    replayInitializeReject = rejectReplayPromise;
    forwardToChild(cachedInitialize.line);
    setTimeout(() => {
      rejectReplay(new Error("Timed out replaying MCP initialize to restarted child"));
    }, 5000).unref();
  });

  await replayInitializePromise;
  replayInitializePromise = undefined;
  replayInitializeResolve = undefined;
  replayInitializeReject = undefined;

  if (cachedInitializedNotification) {
    forwardToChild(cachedInitializedNotification.line);
  }
}

function handleChildLine(line) {
  const message = parseJsonLine(line);
  if (!message) {
    return;
  }

  if (replayInitializePromise && cachedInitialize && message.id === cachedInitialize.message.id) {
    childInitialized = true;
    const resolveReplay = replayInitializeResolve;
    replayInitializePromise = undefined;
    replayInitializeResolve = undefined;
    replayInitializeReject = undefined;
    resolveReplay?.();
    return;
  }

  if (message.id !== undefined) {
    pendingRequests.delete(message.id);
  }

  if (cachedInitialize && message.id === cachedInitialize.message.id) {
    childInitialized = true;
  }

  process.stdout.write(serialize(message));
}

function rememberPending(message) {
  if (message && message.id !== undefined) {
    pendingRequests.set(message.id, message);
  }
}

function rejectPendingRequests(message) {
  for (const id of pendingRequests.keys()) {
    process.stdout.write(
      serialize({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message
        }
      })
    );
  }
  pendingRequests.clear();
}

function rejectReplay(error) {
  if (replayInitializeReject) {
    replayInitializeReject(error);
  }
  replayInitializePromise = undefined;
  replayInitializeResolve = undefined;
  replayInitializeReject = undefined;
}

function forwardToChild(line) {
  if (!child?.stdin.writable) {
    throw new Error("coherent-gt-mcp child stdin is not writable");
  }
  child.stdin.write(line);
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    return undefined;
  }
}

function serialize(message) {
  return `${JSON.stringify(message)}\n`;
}

function shutdown(code) {
  shuttingDown = true;
  child?.kill();
  process.exit(code);
}
