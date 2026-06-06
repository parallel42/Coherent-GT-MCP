import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { sendInspectorCommand } from "../../src/coherent/inspector-client.js";

const servers: WebSocketServer[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
});

describe("inspector client resilience", () => {
  it("retries a one-shot command after the inspector socket resets", async () => {
    const { server, websocketUrl } = await createServer();
    let connections = 0;

    server.on("connection", (socket) => {
      connections += 1;
      socket.once("message", () => {
        if (connections === 1) {
          destroySocket(socket);
          return;
        }

        socket.send(JSON.stringify({ id: 1, result: { ok: true } }));
      });
    });

    await expect(
      sendInspectorCommand({
        websocketUrl,
        method: "Runtime.evaluate",
        timeoutMs: 500
      })
    ).resolves.toMatchObject({
      response: {
        id: 1,
        result: { ok: true }
      }
    });
    expect(connections).toBe(2);
  });

  it("treats a Page.reload socket reset after send as a successful reload", async () => {
    const { server, websocketUrl } = await createServer();
    let connections = 0;

    server.on("connection", (socket) => {
      connections += 1;
      socket.once("message", () => {
        destroySocket(socket);
      });
    });

    await expect(
      sendInspectorCommand({
        websocketUrl,
        method: "Page.reload",
        timeoutMs: 500
      })
    ).resolves.toMatchObject({
      response: {
        id: 1,
        result: {
          reloaded: true,
          connectionClosed: true
        }
      }
    });
    expect(connections).toBe(1);
  });

  it("treats a Page.reload timeout after send as a successful reload", async () => {
    const { server, websocketUrl } = await createServer();
    let receivedReload = false;

    server.on("connection", (socket) => {
      socket.once("message", () => {
        receivedReload = true;
      });
    });

    await expect(
      sendInspectorCommand({
        websocketUrl,
        method: "Page.reload",
        timeoutMs: 50
      })
    ).resolves.toMatchObject({
      response: {
        id: 1,
        result: {
          reloaded: true,
          connectionClosed: true
        }
      }
    });
    expect(receivedReload).toBe(true);
  });

});

async function createServer(): Promise<{ server: WebSocketServer; websocketUrl: string }> {
  const server = new WebSocketServer({ port: 0 });
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unexpected WebSocket server address");
  }
  return {
    server,
    websocketUrl: `ws://127.0.0.1:${address.port}`
  };
}

function destroySocket(socket: WebSocket): void {
  (socket as unknown as { _socket?: { destroy: () => void } })._socket?.destroy();
}
