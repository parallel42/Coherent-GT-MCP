import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { closeWebSocketSafely } from "../../src/coherent/websocket-lifecycle.js";

describe("websocket lifecycle", () => {
  it("absorbs late socket errors after teardown", () => {
    const socket = new WebSocket("ws://127.0.0.1:1");

    closeWebSocketSafely(socket);

    expect(() => socket.emit("error", new Error("late ECONNRESET"))).not.toThrow();
  });
});
