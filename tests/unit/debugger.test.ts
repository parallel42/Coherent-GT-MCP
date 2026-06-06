import { describe, expect, it } from "vitest";
import { DebugSessionManager } from "../../src/tools/debugger.js";

describe("debug session manager", () => {
  it("releases a failed persistent debugger attachment after a socket reset", async () => {
    const manager = new DebugSessionManager({
      debuggerUrl: "http://127.0.0.1:19999",
      timeoutMs: 1000
    });
    const closed: number[] = [];
    (manager as unknown as { sessions: Map<number, unknown> }).sessions.set(9, {
      isOpen: true,
      start: async () => {
        throw new Error("read ECONNRESET");
      },
      close: () => closed.push(9),
      status: () => ({ pageId: 9, open: true })
    });

    await expect(manager.start(9)).rejects.toThrow("Persistent debugger attachment failed");
    expect(closed).toEqual([9]);
    expect(manager.status(9)).toEqual({ pageId: 9, open: false });
  });

  it("releases a failed active debugger command after a socket reset", async () => {
    const manager = new DebugSessionManager({
      debuggerUrl: "http://127.0.0.1:19999",
      timeoutMs: 1000
    });
    const closed: number[] = [];
    (manager as unknown as { sessions: Map<number, unknown> }).sessions.set(9, {
      isOpen: true,
      command: async () => {
        throw new Error("read ECONNRESET");
      },
      close: () => closed.push(9),
      status: () => ({ pageId: 9, open: true })
    });

    await expect(manager.command(9, "Debugger.pause")).rejects.toThrow("read ECONNRESET");
    expect(closed).toEqual([9]);
    expect(manager.status(9)).toEqual({ pageId: 9, open: false });
  });
});
