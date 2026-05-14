import { buildWebsocketUrl } from "../coherent/debugger-client.js";
import type { InspectorCommandResult } from "../coherent/protocol.js";
import { PersistentInspectorSession, type BreakpointRecord } from "../coherent/persistent-inspector.js";

type ManagerOptions = {
  debuggerUrl: string;
  timeoutMs: number;
};

export class DebugSessionManager {
  private readonly sessions = new Map<number, PersistentInspectorSession>();

  constructor(private readonly options: ManagerOptions) {}

  async start(pageId: number, options: { pauseOnExceptions?: "none" | "all" | "uncaught" } = {}): Promise<unknown> {
    const session = this.getOrCreate(pageId);
    return await session.start(options);
  }

  stop(pageId: number): unknown {
    const session = this.sessions.get(pageId);
    if (!session) {
      return { pageId, stopped: false, reason: "No active debugger session" };
    }

    session.close();
    this.sessions.delete(pageId);
    return { pageId, stopped: true };
  }

  status(pageId?: number | undefined): unknown {
    if (pageId !== undefined) {
      const session = this.sessions.get(pageId);
      return session?.status() ?? { pageId, open: false };
    }

    return [...this.sessions.values()].map((session) => session.status());
  }

  async command(pageId: number, method: string, params?: object | undefined): Promise<unknown> {
    return extractResult(method, await this.require(pageId).command(method, params));
  }

  events(pageId: number, options: { sinceSequence?: number | undefined; maxEvents?: number | undefined; eventTypes?: string[] | undefined }): unknown {
    return this.require(pageId).listEvents(options);
  }

  scripts(pageId: number, urlContains?: string | undefined): unknown {
    return this.require(pageId).listScripts(urlContains);
  }

  breakpoints(pageId: number): unknown {
    return this.require(pageId).listBreakpoints();
  }

  paused(pageId: number): unknown {
    return this.require(pageId).paused ?? null;
  }

  async getScriptSource(pageId: number, scriptId: string): Promise<unknown> {
    return await this.command(pageId, "Debugger.getScriptSource", { scriptId });
  }

  async searchScript(
    pageId: number,
    input: { scriptId: string; query: string; caseSensitive: boolean; isRegex: boolean }
  ): Promise<unknown> {
    return await this.command(pageId, "Debugger.searchInContent", input);
  }

  async searchAllScripts(
    pageId: number,
    input: { query: string; urlContains?: string | undefined; caseSensitive: boolean; isRegex: boolean; maxScripts: number }
  ): Promise<unknown> {
    const session = this.require(pageId);
    const matches = [];
    const scripts = session.listScripts(input.urlContains).filter((script) => script.url).slice(0, input.maxScripts);

    for (const script of scripts) {
      const result = extractResult(
        "Debugger.searchInContent",
        await session.command("Debugger.searchInContent", {
          scriptId: script.scriptId,
          query: input.query,
          caseSensitive: input.caseSensitive,
          isRegex: input.isRegex
        })
      ) as { result?: unknown[] };

      if (Array.isArray(result.result) && result.result.length > 0) {
        matches.push({
          script,
          matches: result.result
        });
      }
    }

    return { searchedScripts: scripts.length, matches };
  }

  async setBreakpointByUrl(
    pageId: number,
    input: { url: string; lineNumber: number; columnNumber: number; condition?: string | undefined }
  ): Promise<unknown> {
    const result = (await this.command(pageId, "Debugger.setBreakpointByUrl", input)) as {
      breakpointId?: string;
      locations?: unknown[];
    };
    if (!result.breakpointId) {
      throw new Error("Debugger.setBreakpointByUrl did not return a breakpointId");
    }

    const record = this.require(pageId).rememberBreakpoint({
      id: result.breakpointId,
      kind: "url",
      createdAt: new Date().toISOString(),
      details: { ...input, locations: result.locations ?? [] }
    });

    return { ...result, record };
  }

  async setBreakpoint(
    pageId: number,
    input: { scriptId: string; lineNumber: number; columnNumber: number; condition?: string | undefined }
  ): Promise<unknown> {
    const result = (await this.command(pageId, "Debugger.setBreakpoint", {
      location: {
        scriptId: input.scriptId,
        lineNumber: input.lineNumber,
        columnNumber: input.columnNumber
      },
      condition: input.condition ?? ""
    })) as { breakpointId?: string; actualLocation?: unknown };

    if (!result.breakpointId) {
      throw new Error("Debugger.setBreakpoint did not return a breakpointId");
    }

    const record = this.require(pageId).rememberBreakpoint({
      id: result.breakpointId,
      kind: "location",
      createdAt: new Date().toISOString(),
      details: { ...input, actualLocation: result.actualLocation }
    });

    return { ...result, record };
  }

  async removeBreakpoint(pageId: number, breakpointId: string): Promise<unknown> {
    const record = this.require(pageId).forgetBreakpoint(breakpointId);
    if (record?.kind === "event-listener") {
      await this.command(pageId, "DOMDebugger.removeEventListenerBreakpoint", {
        eventName: record.details.eventName
      });
      return { removed: true, record };
    }
    if (record?.kind === "xhr") {
      await this.command(pageId, "DOMDebugger.removeXHRBreakpoint", {
        url: record.details.url
      });
      return { removed: true, record };
    }
    if (record?.kind === "dom") {
      await this.command(pageId, "DOMDebugger.removeDOMBreakpoint", {
        nodeId: record.details.nodeId,
        type: record.details.type
      });
      return { removed: true, record };
    }

    await this.command(pageId, "Debugger.removeBreakpoint", { breakpointId });
    return { removed: true, record: record ?? null };
  }

  async setEventListenerBreakpoint(pageId: number, eventName: string): Promise<unknown> {
    await this.command(pageId, "DOMDebugger.setEventListenerBreakpoint", { eventName });
    return this.require(pageId).rememberBreakpoint({
      id: `event-listener:${eventName}`,
      kind: "event-listener",
      createdAt: new Date().toISOString(),
      details: { eventName }
    });
  }

  async setXhrBreakpoint(pageId: number, url: string): Promise<unknown> {
    await this.command(pageId, "DOMDebugger.setXHRBreakpoint", { url });
    return this.require(pageId).rememberBreakpoint({
      id: `xhr:${url}`,
      kind: "xhr",
      createdAt: new Date().toISOString(),
      details: { url }
    });
  }

  async setDomBreakpoint(pageId: number, input: { selector: string; type: string }): Promise<unknown> {
    const session = this.require(pageId);
    const nodeId = await resolveNodeId(session, input.selector);
    await this.command(pageId, "DOMDebugger.setDOMBreakpoint", {
      nodeId,
      type: input.type
    });
    return session.rememberBreakpoint({
      id: `dom:${nodeId}:${input.type}`,
      kind: "dom",
      createdAt: new Date().toISOString(),
      details: { ...input, nodeId }
    });
  }

  async evaluateOnCallFrame(
    pageId: number,
    input: { callFrameId?: string | undefined; expression: string; returnByValue: boolean }
  ): Promise<unknown> {
    const session = this.require(pageId);
    const callFrameId = input.callFrameId ?? getTopCallFrameId(session.paused);
    if (!callFrameId) {
      throw new Error("No callFrameId supplied and the debugger is not paused");
    }

    return await this.command(pageId, "Debugger.evaluateOnCallFrame", {
      callFrameId,
      expression: input.expression,
      returnByValue: input.returnByValue
    });
  }

  private getOrCreate(pageId: number): PersistentInspectorSession {
    const existing = this.sessions.get(pageId);
    if (existing?.isOpen) {
      return existing;
    }

    const session = new PersistentInspectorSession(
      pageId,
      buildWebsocketUrl(this.options.debuggerUrl, pageId),
      this.options.timeoutMs
    );
    this.sessions.set(pageId, session);
    return session;
  }

  private require(pageId: number): PersistentInspectorSession {
    const session = this.sessions.get(pageId);
    if (!session?.isOpen) {
      throw new Error(`No active debugger session for pageId ${pageId}; call coherentgt_debug_start first`);
    }

    return session;
  }
}

async function resolveNodeId(session: PersistentInspectorSession, selector: string): Promise<number> {
  const documentResult = extractResult("DOM.getDocument", await session.command("DOM.getDocument"));
  const rootNodeId = (documentResult as { root?: { nodeId?: unknown } }).root?.nodeId;
  if (typeof rootNodeId !== "number") {
    throw new Error("DOM.getDocument did not return a root node id");
  }

  const queryResult = extractResult(
    "DOM.querySelector",
    await session.command("DOM.querySelector", {
      nodeId: rootNodeId,
      selector
    })
  );
  const nodeId = (queryResult as { nodeId?: unknown }).nodeId;
  if (typeof nodeId !== "number" || nodeId <= 0) {
    throw new Error(`No node matched selector: ${selector}`);
  }

  return nodeId;
}

function getTopCallFrameId(paused: unknown): string | undefined {
  const callFrames = (paused as { callFrames?: Array<{ callFrameId?: unknown }> } | undefined)?.callFrames;
  const callFrameId = callFrames?.[0]?.callFrameId;
  return typeof callFrameId === "string" ? callFrameId : undefined;
}

function extractResult(method: string, result: InspectorCommandResult): unknown {
  if (result.response.error) {
    throw new Error(`${method} failed: ${result.response.error.message}`);
  }

  return result.response.result ?? {};
}
