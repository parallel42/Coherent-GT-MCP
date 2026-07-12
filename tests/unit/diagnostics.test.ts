import { describe, expect, it } from "vitest";
import type { InspectorCommandResult } from "../../src/coherent/protocol.js";
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
      debuggerUrl: "http://debugger.example.local:19999",
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
      debuggerUrl: "http://debugger.example.local:19999",
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

  it("runs diagnose page probes through the active diagnostic session", async () => {
    const manager = new DiagnosticSessionManager({
      debuggerUrl: "http://debugger.example.local:19999",
      timeoutMs: 1000,
      hostCorrelation: {
        hostHelperUrl: null,
        processNames: [],
        logRoots: [],
        resourceRoots: []
      }
    });
    const commands: string[] = [];
    const resourceTree = {
      frameTree: {
        frame: { id: "main-frame" },
        resources: [{ url: "coui://worldutility/app.js", type: "Script", mimeType: "text/javascript" }]
      }
    };
    const session = {
      isOpen: true,
      ensureOpen: async () => {},
      command: async (method: string, params?: object): Promise<InspectorCommandResult> => {
        commands.push(method);
        if (method === "Runtime.evaluate") {
          return inspectorResult({
            result: {
              type: "object",
              value: {
                title: "World Utility",
                href: "coui://worldutility/index.html",
                readyState: "complete",
                rafFrames: commands.filter((entry) => entry === "Runtime.evaluate").length,
                sampledAt: Date.now(),
                requestedSampleMs: 0
              }
            }
          });
        }
        if (method === "Page.getResourceTree") {
          return inspectorResult(resourceTree);
        }
        if (method === "Page.getResourceContent") {
          return inspectorResult({ content: "console.log('ready');", base64Encoded: false });
        }
        if (method === "DOM.getDocument") {
          return inspectorResult({ root: { nodeId: 1 } });
        }
        if (method === "DOM.querySelector") {
          expect(params).toEqual({ nodeId: 1, selector: ".create-scene" });
          return inspectorResult({ nodeId: 2 });
        }
        if (method === "DOM.getBoxModel") {
          return inspectorResult({ model: { width: 120, height: 32, content: [10, 20, 130, 20, 130, 52, 10, 52] } });
        }
        if (method === "CSS.enable") {
          return inspectorResult({});
        }
        if (method === "CSS.getComputedStyleForNode") {
          return inspectorResult({
            computedStyle: [
              { name: "display", value: "block" },
              { name: "visibility", value: "visible" },
              { name: "opacity", value: "1" }
            ]
          });
        }
        if (method === "DOM.getOuterHTML") {
          return inspectorResult({ outerHTML: '<button class="create-scene">Create Scene</button>' });
        }
        throw new Error(`Unexpected command ${method}`);
      },
      tryCommand: async (method: string) => {
        commands.push(`try:${method}`);
        if (method === "Page.getResourceTree") {
          return { ok: true, result: resourceTree };
        }
        return { ok: true, result: {} };
      },
      listEvents: () => [
        {
          sequence: 1,
          timestamp: "2026-07-03T00:00:00.000Z",
          method: "Network.requestWillBeSent",
          rawId: "event:1",
          params: {
            requestId: "req-1",
            request: { url: "coui://worldutility/app.js", method: "GET" }
          }
        }
      ],
      supportedCommands: () => ["Runtime.enable", "Page.enable", "DOM.enable"],
      close: () => {}
    };
    (manager as unknown as { sessions: Map<number, unknown> }).sessions.set(7, session);
    (manager as unknown as { pageHealth: () => Promise<unknown> }).pageHealth = async () => {
      throw new Error("diagnosePage should reuse the active session instead of calling pageHealth");
    };

    const result = await manager.diagnosePage(
      {
        listViews: async () => [
          {
            id: 7,
            title: "World Utility",
            url: "coui://worldutility/index.html",
            inspectorUrl: "http://debugger.example.local:19999/inspector/7",
            websocketUrl: "ws://debugger.example.local:19999/7"
          }
        ]
      },
      {
        pageId: 7,
        sampleMs: 0,
        consoleLevels: [],
        selectors: [".create-scene"],
        resources: ["coui://worldutility/app.js"]
      }
    );

    expect(result).toMatchObject({
      selectors: [{ selector: ".create-scene", found: true }],
      resourceProbes: [{ url: "coui://worldutility/app.js", foundInResourceTree: true }]
    });
    expect(commands).toEqual(
      expect.arrayContaining([
        "Runtime.evaluate",
        "try:Page.getResourceTree",
        "DOM.getDocument",
        "DOM.querySelector",
        "Page.getResourceTree",
        "Page.getResourceContent"
      ])
    );
  });

  it("retries a diagnostic command once after a stale session reset", async () => {
    const manager = new DiagnosticSessionManager({
      debuggerUrl: "http://127.0.0.1:19999",
      timeoutMs: 1000,
      hostCorrelation: {
        hostHelperUrl: null,
        processNames: [],
        logRoots: [],
        resourceRoots: []
      }
    });
    const closed: string[] = [];
    const sessions = [
      {
        ensureOpen: async () => {},
        listEvents: () => {
          throw new Error("read ECONNRESET");
        },
        close: () => closed.push("stale")
      },
      {
        ensureOpen: async () => {},
        listEvents: () => [],
        close: () => closed.push("fresh")
      }
    ];
    (manager as unknown as { getOrCreate: () => unknown }).getOrCreate = () => sessions.shift();

    await expect(manager.networkSnapshot(9, { maxEvents: 100, maxPayloadChars: 240 })).resolves.toEqual({
      requestCount: 0,
      webSocketCount: 0,
      requests: [],
      webSockets: []
    });
    expect(closed).toEqual(["stale"]);
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

function inspectorResult(result: unknown): InspectorCommandResult {
  return {
    response: {
      id: 1,
      result
    },
    events: []
  };
}
