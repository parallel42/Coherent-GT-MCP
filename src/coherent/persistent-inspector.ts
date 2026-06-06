import WebSocket from "ws";
import type { InspectorCommandResponse, InspectorCommandResult, InspectorEvent } from "./protocol.js";

export type DebugEvent = InspectorEvent & {
  sequence: number;
  timestamp: string;
};

export type DebugScript = {
  scriptId: string;
  url: string;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  sourceMapURL?: string;
  hash?: string;
  isContentScript?: boolean;
};

export type BreakpointRecord = {
  id: string;
  kind: "url" | "location" | "event-listener" | "xhr" | "dom";
  createdAt: string;
  details: Record<string, unknown>;
};

type PendingCommand = {
  method: string;
  timeout: NodeJS.Timeout;
  resolve: (result: InspectorCommandResult) => void;
  reject: (error: Error) => void;
};

export class PersistentInspectorSession {
  private socket?: WebSocket;
  private commandId = 1;
  private opened = false;
  private closed = false;
  private pending = new Map<number, PendingCommand>();
  private eventSequence = 0;
  private readonly events: DebugEvent[] = [];
  private readonly scripts = new Map<string, DebugScript>();
  private readonly breakpoints = new Map<string, BreakpointRecord>();
  private readonly capability = new Map<string, boolean>();
  private pausedState: unknown;

  constructor(
    readonly pageId: number,
    readonly websocketUrl: string,
    private readonly timeoutMs: number,
    private readonly maxEvents = 500
  ) {}

  get isOpen(): boolean {
    return this.opened && !this.closed && this.socket?.readyState === WebSocket.OPEN;
  }

  get paused(): unknown {
    return this.pausedState;
  }

  async start(options: { pauseOnExceptions?: "none" | "all" | "uncaught" } = {}): Promise<unknown> {
    if (this.isOpen) {
      return this.status();
    }

    this.socket = new WebSocket(this.websocketUrl);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out after ${this.timeoutMs}ms opening debugger session`));
      }, this.timeoutMs);

      this.socket?.on("open", () => {
        clearTimeout(timeout);
        this.opened = true;
        resolve();
      });

      this.socket?.on("message", (data) => this.handleMessage(data));
      this.socket?.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      this.socket?.on("close", () => this.closePending("Inspector session closed"));
    });

    await this.tryCommand("Runtime.enable");
    await this.tryCommand("Page.enable");
    const debuggerEnable = await this.tryCommand("Debugger.enable");
    if (!debuggerEnable.ok) {
      throw new Error(`Debugger.enable failed: ${debuggerEnable.error}`);
    }
    await this.tryCommand("Debugger.setBreakpointsActive", { active: true });
    await this.tryCommand("Debugger.setPauseOnExceptions", { state: options.pauseOnExceptions ?? "none" });

    return this.status();
  }

  async command(method: string, params?: object | undefined, timeoutMs = this.timeoutMs): Promise<InspectorCommandResult> {
    if (!this.isOpen || !this.socket) {
      throw new Error("Debugger session is not open");
    }

    const id = this.commandId++;
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        method,
        timeout,
        resolve,
        reject
      });

      this.socket?.send(
        JSON.stringify({
          id,
          method,
          params: params ?? {}
        })
      );
    });
  }

  status(): Record<string, unknown> {
    return {
      pageId: this.pageId,
      websocketUrl: this.websocketUrl,
      open: this.isOpen,
      paused: this.pausedState !== undefined,
      scriptCount: this.scripts.size,
      breakpointCount: this.breakpoints.size,
      eventCount: this.events.length,
      lastEventSequence: this.eventSequence,
      supported: [...this.capability.entries()].filter(([, ok]) => ok).map(([method]) => method),
      unsupported: [...this.capability.entries()].filter(([, ok]) => !ok).map(([method]) => method)
    };
  }

  listEvents(options: {
    sinceSequence?: number | undefined;
    maxEvents?: number | undefined;
    eventTypes?: string[] | undefined;
  }): DebugEvent[] {
    const since = options.sinceSequence ?? 0;
    const max = options.maxEvents ?? 50;
    const eventTypes = new Set(options.eventTypes ?? []);
    return this.events
      .filter((event) => event.sequence > since)
      .filter((event) => eventTypes.size === 0 || eventTypes.has(event.method))
      .slice(-max);
  }

  listScripts(urlContains?: string | undefined): DebugScript[] {
    return [...this.scripts.values()]
      .filter((script) => !urlContains || script.url.toLowerCase().includes(urlContains.toLowerCase()))
      .sort((a, b) => a.url.localeCompare(b.url) || Number(a.scriptId) - Number(b.scriptId));
  }

  rememberBreakpoint(record: BreakpointRecord): BreakpointRecord {
    this.breakpoints.set(record.id, record);
    return record;
  }

  forgetBreakpoint(id: string): BreakpointRecord | undefined {
    const existing = this.breakpoints.get(id);
    this.breakpoints.delete(id);
    return existing;
  }

  listBreakpoints(): BreakpointRecord[] {
    return [...this.breakpoints.values()];
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.opened = false;
    this.closePending("Inspector session closed");
    this.socket?.removeAllListeners();
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    }
  }

  private async tryCommand(method: string, params?: object | undefined): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    if (this.capability.get(method) === false) {
      return { ok: false, error: `${method} is not supported by this Coherent WebInspector target` };
    }

    try {
      const result = await this.command(method, params);
      if (result.response.error) {
        this.capability.set(method, false);
        return { ok: false, error: result.response.error.message };
      }
      this.capability.set(method, true);
      return { ok: true, result: result.response.result ?? {} };
    } catch (error) {
      this.capability.set(method, false);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private handleMessage(data: WebSocket.RawData): void {
    let message: unknown;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (isInspectorEvent(message)) {
      this.recordEvent(message);
      return;
    }

    if (!isInspectorResponse(message)) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    pending.resolve({
      response: message,
      events: []
    });
  }

  private recordEvent(event: InspectorEvent): void {
    const debugEvent: DebugEvent = {
      ...event,
      sequence: ++this.eventSequence,
      timestamp: new Date().toISOString()
    };
    this.events.push(debugEvent);
    while (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    if (event.method === "Debugger.scriptParsed" && event.params && typeof event.params === "object") {
      const params = event.params as Record<string, unknown>;
      const scriptId = params.scriptId;
      if (typeof scriptId === "string") {
        const script: DebugScript = {
          scriptId,
          url: typeof params.url === "string" ? params.url : ""
        };
        if (typeof params.startLine === "number") script.startLine = params.startLine;
        if (typeof params.startColumn === "number") script.startColumn = params.startColumn;
        if (typeof params.endLine === "number") script.endLine = params.endLine;
        if (typeof params.endColumn === "number") script.endColumn = params.endColumn;
        if (typeof params.sourceMapURL === "string") script.sourceMapURL = params.sourceMapURL;
        if (typeof params.hash === "string") script.hash = params.hash;
        if (typeof params.isContentScript === "boolean") script.isContentScript = params.isContentScript;
        this.scripts.set(scriptId, script);
      }
    }

    if (event.method === "Debugger.paused") {
      this.pausedState = event.params ?? {};
    } else if (event.method === "Debugger.resumed") {
      this.pausedState = undefined;
    }
  }

  private closePending(message: string): void {
    for (const [, command] of this.pending) {
      clearTimeout(command.timeout);
      command.reject(new Error(`${message} while waiting for ${command.method}`));
    }
    this.pending.clear();
  }
}

function isInspectorResponse(value: unknown): value is InspectorCommandResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  return typeof (value as { id?: unknown }).id === "number";
}

function isInspectorEvent(value: unknown): value is InspectorEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  return typeof (value as { method?: unknown }).method === "string" && (value as { id?: unknown }).id === undefined;
}
