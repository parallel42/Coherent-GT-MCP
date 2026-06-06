import { describe, expect, it } from "vitest";
import type { DiagnosticEvent } from "../../src/tools/diagnostics.js";
import {
  DiagnosticSessionManager,
  buildEventListenerProbeExpression,
  buildPageHealthExpression,
  buildRuntimeProbeExpression,
  summarizeStartupCommandResults,
  summarizeConsoleEvents,
  summarizeNetworkEvents,
  summarizeRuntimeErrors
} from "../../src/tools/diagnostics.js";

describe("diagnostic helpers", () => {
  it("releases a diagnostic session for a page", () => {
    const manager = new DiagnosticSessionManager({
      debuggerUrl: "http://host.docker.internal:19999",
      timeoutMs: 1000,
      hostCorrelation: {
        hostHelperUrl: null,
        processNames: [],
        logRoots: [],
        resourceRoots: []
      }
    });
    const closed: number[] = [];
    (manager as unknown as { sessions: Map<number, unknown> }).sessions.set(7, {
      close: () => closed.push(7)
    });

    expect(manager.release(7)).toEqual({ pageId: 7, released: true });
    expect(closed).toEqual([7]);
    expect(manager.status(7)).toEqual({ pageId: 7, open: false });
  });

  it("can release the diagnostic session after a transient network lookup", async () => {
    const manager = new DiagnosticSessionManager({
      debuggerUrl: "http://host.docker.internal:19999",
      timeoutMs: 1000,
      hostCorrelation: {
        hostHelperUrl: null,
        processNames: [],
        logRoots: [],
        resourceRoots: []
      }
    });
    const closed: number[] = [];
    (manager as unknown as { sessions: Map<number, unknown> }).sessions.set(8, {
      isOpen: true,
      ensureOpen: async () => {},
      listEvents: () => [
        {
          sequence: 1,
          timestamp: "2026-06-06T00:00:00.000Z",
          method: "Network.requestWillBeSent",
          rawId: "event:1",
          params: {
            requestId: "req-1",
            request: { url: "coui://example/app.js", method: "GET" }
          }
        }
      ],
      close: () => closed.push(8),
      status: () => ({ pageId: 8, open: true })
    });

    await expect(manager.networkForUrl(8, "coui://example/app.js", { releaseAfter: true })).resolves.toMatchObject({
      url: "coui://example/app.js"
    });
    expect(closed).toEqual([8]);
    expect(manager.status(8)).toEqual({ pageId: 8, open: false });
  });

  it("builds old-WebKit-compatible page health probes", () => {
    const expression = buildPageHealthExpression(250);

    expect(expression).toContain("requestAnimationFrame");
    expect(expression).not.toContain("Array.from");
    expect(expression).not.toContain("Object.fromEntries");
    expect(expression).not.toContain("...");
    expect(expression).not.toContain("globalThis");
  });

  it("builds global probe reads without mutating state", () => {
    expect(buildRuntimeProbeExpression(["app.ready", "window.engine"])).toContain(JSON.stringify(["app.ready", "window.engine"]));
    expect(buildRuntimeProbeExpression(["app.ready"])).not.toContain("globalThis");
  });

  it("builds listener probe expressions for a selector", () => {
    expect(buildEventListenerProbeExpression("body")).toContain(JSON.stringify("body"));
  });

  it("summarizes partial diagnostic startup capability", () => {
    expect(
      summarizeStartupCommandResults([
        { method: "Runtime.enable", ok: false, error: "Inspector session closed while waiting for Runtime.enable" },
        { method: "Console.enable", ok: true },
        { method: "Page.enable", ok: true }
      ])
    ).toEqual({
      supported: ["Console.enable", "Page.enable"],
      unsupported: ["Runtime.enable"],
      errors: [{ method: "Runtime.enable", error: "Inspector session closed while waiting for Runtime.enable" }]
    });
  });

  it("handles document listener probes without treating document as a CSS selector", () => {
    const expression = buildEventListenerProbeExpression("document");

    expect(expression).toContain("var node = document;");
    expect(expression).not.toContain('querySelector("document")');
  });

  it("summarizes console messages by level and text", () => {
    const events: DiagnosticEvent[] = [
      {
        sequence: 1,
        timestamp: "2026-06-04T00:00:00.000Z",
        method: "Console.messageAdded",
        rawId: "event:1",
        params: { message: { level: "error", text: "bad", url: "coui://app.js", line: 1 } }
      },
      {
        sequence: 2,
        timestamp: "2026-06-04T00:00:01.000Z",
        method: "Console.messageAdded",
        rawId: "event:2",
        params: { message: { level: "log", text: "noise" } }
      }
    ];

    expect(summarizeConsoleEvents(events, { levels: ["error"], maxEvents: 10 })).toMatchObject({
      count: 1,
      messages: [{ level: "error", text: "bad", url: "coui://app.js", line: 1 }]
    });
  });

  it("summarizes runtime exceptions with stack frames", () => {
    const events: DiagnosticEvent[] = [
      {
        sequence: 1,
        timestamp: "2026-06-04T00:00:00.000Z",
        method: "Runtime.exceptionThrown",
        rawId: "event:1",
        params: {
          exceptionDetails: {
            text: "ReferenceError: missing",
            url: "coui://app.js",
            line: 0,
            column: 5,
            stackTrace: {
              callFrames: [{ functionName: "tick", url: "coui://app.js", lineNumber: 0, columnNumber: 5 }]
            }
          }
        }
      }
    ];

    expect(summarizeRuntimeErrors(events, { maxEvents: 5 })).toMatchObject({
      count: 1,
      errors: [
        {
          text: "ReferenceError: missing",
          url: "coui://app.js",
          line: 0,
          column: 5,
          stackFrames: [{ functionName: "tick" }]
        }
      ]
    });
  });

  it("summarizes WebSocket network events with capped frame payloads", () => {
    const events: DiagnosticEvent[] = [
      {
        sequence: 1,
        timestamp: "2026-06-04T00:00:00.000Z",
        method: "Network.webSocketCreated",
        rawId: "event:1",
        params: { requestId: "ws1", url: "ws://localhost/socket" }
      },
      {
        sequence: 2,
        timestamp: "2026-06-04T00:00:01.000Z",
        method: "Network.webSocketFrameSent",
        rawId: "event:2",
        params: { requestId: "ws1", timestamp: 10, response: { payloadData: "abcdef" } }
      },
      {
        sequence: 3,
        timestamp: "2026-06-04T00:00:02.000Z",
        method: "Network.webSocketClosed",
        rawId: "event:3",
        params: { requestId: "ws1", timestamp: 11 }
      }
    ];

    expect(summarizeNetworkEvents(events, { maxPayloadChars: 3 })).toEqual({
      requestCount: 0,
      webSocketCount: 1,
      requests: [],
      webSockets: [
        {
          requestId: "ws1",
          url: "ws://localhost/socket",
          state: "closed",
          createdAt: 10,
          closedAt: 11,
          sentFrameCount: 1,
          receivedFrameCount: 0,
          lastSent: { timestamp: 10, opcode: undefined, payload: "abc", truncated: true, rawId: "event:2" },
          lastReceived: undefined
        }
      ]
    });
  });
});
