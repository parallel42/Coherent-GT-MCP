import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { createMcpServer, createMcpSharedState } from "./mcp-server.js";

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.transport === "http") {
    await runHttpServer(config);
    return;
  }

  const state = createMcpSharedState(config);
  const server = createMcpServer(config, {
    state,
    onIdle: async () => {
      state.debugSessions.stopAll();
      console.error(`coherent-gt-mcp exiting after ${config.idleTimeoutMs}ms without tool calls`);
      await server.close();
      process.exit(0);
    }
  });
  await server.connect(new StdioServerTransport());
}

async function runHttpServer(config: ReturnType<typeof loadConfig>): Promise<void> {
  const sharedState = createMcpSharedState(config);
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: ReturnType<typeof createMcpServer> }>();

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (url.pathname === "/health" && req.method === "GET") {
        writeJson(res, 200, {
          ok: true,
          transport: "http",
          mcpPath: config.httpPath,
          sessions: sessions.size
        });
        return;
      }

      if (url.pathname !== config.httpPath) {
        writeJson(res, 404, { error: "Not found" });
        return;
      }

      if (req.method === "OPTIONS") {
        writeCorsHeaders(res);
        res.writeHead(204).end();
        return;
      }

      if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") {
        writeMcpError(res, 405, -32000, "Method not allowed.");
        return;
      }

      const body = req.method === "POST" ? await readJsonBody(req) : undefined;
      let session = getExistingSession(req, sessions);

      if (!session && req.method === "POST" && body !== undefined && isInitializeRequest(body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            sessions.set(sessionId, { transport, server });
            console.error(`coherent-gt-mcp HTTP session initialized: ${sessionId}`);
          }
        });
        const server = createMcpServer(config, {
          state: sharedState,
          enableIdleShutdown: false
        });

        transport.onclose = () => {
          const sessionId = transport.sessionId;
          if (sessionId) {
            sessions.delete(sessionId);
            console.error(`coherent-gt-mcp HTTP session closed: ${sessionId}`);
          }
        };

        await server.connect(transport as unknown as Transport);
        session = { transport, server };
      }

      if (!session) {
        writeMcpError(res, 400, -32000, "Bad Request: No valid MCP session id provided.");
        return;
      }

      await session.transport.handleRequest(req, res, body);
    } catch (error) {
      console.error(error instanceof Error ? error.stack ?? error.message : error);

      if (!res.headersSent) {
        writeMcpError(res, 500, -32603, "Internal server error");
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.httpPort, config.httpHost, () => {
      httpServer.off("error", reject);
      console.error(`coherent-gt-mcp HTTP server listening on http://${config.httpHost}:${config.httpPort}${config.httpPath}`);
      resolve();
    });
  });

  const shutdown = async (): Promise<void> => {
    for (const { server } of sessions.values()) {
      await server.close();
    }
    sessions.clear();
    sharedState.debugSessions.stopAll();
    httpServer.close();
  };

  process.on("SIGINT", () => {
    shutdown()
      .catch((error) => console.error(error instanceof Error ? error.stack ?? error.message : error))
      .finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    shutdown()
      .catch((error) => console.error(error instanceof Error ? error.stack ?? error.message : error))
      .finally(() => process.exit(0));
  });
}

function getExistingSession(
  req: IncomingMessage,
  sessions: Map<string, { transport: StreamableHTTPServerTransport; server: ReturnType<typeof createMcpServer> }>
): { transport: StreamableHTTPServerTransport; server: ReturnType<typeof createMcpServer> } | undefined {
  const sessionId = req.headers["mcp-session-id"];
  return typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim() === "" ? undefined : JSON.parse(text);
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  writeCorsHeaders(res);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function writeMcpError(res: ServerResponse, httpStatus: number, code: number, message: string): void {
  writeJson(res, httpStatus, {
    jsonrpc: "2.0",
    error: { code, message },
    id: null
  });
}

function writeCorsHeaders(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,mcp-session-id,mcp-protocol-version");
  res.setHeader("access-control-expose-headers", "mcp-session-id,mcp-protocol-version");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
