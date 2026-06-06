import WebSocket from "ws";
import { buildWebsocketUrl } from "../coherent/debugger-client.js";
import type { CoherentDebuggerClient } from "../coherent/debugger-client.js";
import { isRetriableInspectorError } from "../coherent/inspector-client.js";
import type { InspectorCommandResponse, InspectorCommandResult, InspectorEvent } from "../coherent/protocol.js";
import { closeWebSocketSafely } from "../coherent/websocket-lifecycle.js";
import { filterInspectableViews, toPageSummary, type PageSummary } from "./pages.js";
import { normalizeEvaluateResult, normalizeInspectorError } from "./evaluate.js";
import { probeImage, probeResource } from "./resource-probe.js";
import { inspectSelector } from "./selector-inspection.js";
import { runtimeEvaluateParams } from "./runtime.js";
import { queryHostCorrelation, type HostCorrelationOptions } from "./host-helper.js";

export type DiagnosticEvent = InspectorEvent & {
  sequence: number;
  timestamp: string;
  rawId: string;
};

type PendingCommand = {
  method: string;
  timeout: NodeJS.Timeout;
  resolve: (result: InspectorCommandResult) => void;
  reject: (error: Error) => void;
};

type DiagnosticOptions = {
  debuggerUrl: string;
  timeoutMs: number;
  hostCorrelation: HostCorrelationOptions;
};

export type StartupCommandResult = {
  method: string;
  ok: boolean;
  error?: string | undefined;
};

type EventFilter = {
  sinceSequence?: number | undefined;
  maxEvents?: number | undefined;
  eventTypes?: string[] | undefined;
};

const DEFAULT_ENABLE_COMMANDS = ["Runtime.enable", "Console.enable", "Debugger.enable", "Page.enable", "Network.enable", "DOM.enable"];

export class DiagnosticSessionManager {
  private readonly sessions = new Map<number, DiagnosticSession>();

  constructor(private readonly options: DiagnosticOptions) {}

  async start(pageId: number): Promise<unknown> {
    const session = this.getOrCreate(pageId);
    await session.ensureOpen();
    return session.status();
  }

  async consoleSnapshot(pageId: number, options: { levels?: string[] | undefined; maxEvents: number; textContains?: string | undefined }): Promise<unknown> {
    return await this.withSession(pageId, (session) => summarizeConsoleEvents(session.listEvents({ maxEvents: 1000 }), options));
  }

  async runtimeErrors(pageId: number, options: { maxEvents: number }): Promise<unknown> {
    return await this.withSession(pageId, (session) => summarizeRuntimeErrors(session.listEvents({ maxEvents: 1000 }), options));
  }

  async pageHealth(pageId: number, options: { sampleMs: number; globalProbes?: string[] | undefined }): Promise<unknown> {
    return await this.withSession(pageId, async (session) => {
      const before = normalizeEvaluateResult(
        await session.command("Runtime.evaluate", runtimeEvaluateParams({ expression: buildPageHealthExpression(options.sampleMs) }))
      );
      await delay(options.sampleMs);
      const health = normalizeEvaluateResult(
        await session.command("Runtime.evaluate", runtimeEvaluateParams({ expression: buildPageHealthExpression(options.sampleMs) }))
      );
      health.value = mergeHealthSamples(before.value, health.value, options.sampleMs);
      const probes =
        options.globalProbes && options.globalProbes.length > 0
          ? normalizeEvaluateResult(
              await session.command("Runtime.evaluate", runtimeEvaluateParams({ expression: buildRuntimeProbeExpression(options.globalProbes) }))
            )
          : undefined;

      return {
        pageId,
        health,
        probes
      };
    });
  }

  async networkSnapshot(pageId: number, options: { maxEvents: number; maxPayloadChars: number }): Promise<unknown> {
    return await this.withSession(pageId, (session) =>
      summarizeNetworkEvents(session.listEvents({ maxEvents: options.maxEvents }), {
        maxPayloadChars: options.maxPayloadChars
      })
    );
  }

  async eventListeners(pageId: number, options: { selector: string }): Promise<unknown> {
    return await this.withSession(pageId, async (session) => {
      const expression = buildNodeReferenceExpression(options.selector);
      const nodeObject = normalizeEvaluateResult(
        await session.command("Runtime.evaluate", {
          expression,
          returnByValue: false,
          objectGroup: "coherentgt-diagnostics"
        })
      );
      const objectId = readRecord(readRecord((await session.lastResponse())?.response?.result).result).objectId;

      if (typeof objectId === "string") {
        const nativeResult = await session.tryCommand("DOMDebugger.getEventListeners", { objectId });
        if (nativeResult.ok) {
          return {
            selector: options.selector,
            source: "DOMDebugger.getEventListeners",
            result: nativeResult.result
          };
        }
      }

      return {
        selector: options.selector,
        source: "runtime-probe",
        node: nodeObject,
        result: normalizeEvaluateResult(
          await session.command("Runtime.evaluate", runtimeEvaluateParams({ expression: buildEventListenerProbeExpression(options.selector) }))
        )
      };
    });
  }

  async traceEvents(pageId: number, options: EventFilter & { timeoutMs: number }): Promise<unknown> {
    return await this.withSession(pageId, async (session) => {
      await delay(options.timeoutMs);
      return session.listEvents(options);
    });
  }

  async diagnosePage(
    client: CoherentDebuggerClient,
    input: {
      pageId?: number | undefined;
      pageFilter?: string | { titleContains?: string | undefined; urlContains?: string | undefined } | undefined;
      sampleMs: number;
      consoleLevels: string[];
      globalProbes?: string[] | undefined;
      selectors?: string[] | undefined;
      resources?: string[] | undefined;
      images?: string[] | undefined;
    }
  ): Promise<unknown> {
    let selectedPageId: number | undefined;
    try {
      const views = await client.listViews();
      const page = selectPage(this.options.debuggerUrl, views, input.pageId, input.pageFilter);
      selectedPageId = page.id;
      return await this.withSession(page.id, async (session) => {
        const [health, resourceTree, hostCorrelation] = await Promise.all([
          this.pageHealth(page.id, { sampleMs: input.sampleMs, globalProbes: input.globalProbes }).catch((error) => ({
            pageId: page.id,
            health: normalizeInspectorError(error, { method: "Runtime.evaluate", timeoutMs: this.options.timeoutMs })
          })),
          session.tryCommand("Page.getResourceTree"),
          queryHostCorrelation(this.options.hostCorrelation)
        ]);
        const events = session.listEvents({ maxEvents: 1000 });
        const consoleSummary = summarizeConsoleEvents(events, { levels: input.consoleLevels, maxEvents: 50 });
        const runtimeErrors = summarizeRuntimeErrors(events, { maxEvents: 50 });
        const network = summarizeNetworkEvents(events, { maxPayloadChars: 240 });
        const resourceSummary = summarizeResourceTree(resourceTree.ok ? resourceTree.result : undefined);
        const selectors = await Promise.all((input.selectors ?? []).map((selector) => this.inspectSelectorProbe(page.id, selector)));
        const resourceProbes = await Promise.all((input.resources ?? []).map((url) => this.resourceProbe(page.id, url)));
        const imageProbes = await Promise.all((input.images ?? []).map((url) => this.imageProbe(page.id, url)));

        return {
          page,
          console: consoleSummary,
          runtimeErrors,
          health,
          resources: resourceSummary,
          network,
          listeners: {
            observedEventCount: events.length,
            supported: session.supportedCommands()
          },
          hostCorrelation,
          selectors,
          resourceProbes,
          imageProbes,
          runtime: runtimeStatus(health),
          likelyCauses: buildLikelyCauses(consoleSummary, runtimeErrors, health, network, {
            selectors,
            resourceProbes,
            imageProbes
          })
        };
      });
    } finally {
      if (selectedPageId !== undefined) {
        this.release(selectedPageId);
      }
    }
  }

  async networkForUrl(
    pageId: number,
    url: string,
    options: { releaseAfter?: boolean | undefined } = {}
  ): Promise<Record<string, unknown> | undefined> {
    try {
      return await this.withSession(pageId, (session) => {
        const summary = summarizeNetworkEvents(session.listEvents({ maxEvents: 5000 }), { maxPayloadChars: 240 });
        return summary.requests.find((entry) => readRecord(entry).url === url) as Record<string, unknown> | undefined;
      });
    } finally {
      if (options.releaseAfter) {
        this.release(pageId);
      }
    }
  }

  release(pageId: number): unknown {
    const session = this.sessions.get(pageId);
    if (!session) {
      return { pageId, released: false, reason: "No active diagnostic session" };
    }

    session.close();
    this.sessions.delete(pageId);
    return { pageId, released: true };
  }

  status(pageId?: number | undefined): unknown {
    if (pageId !== undefined) {
      return this.sessions.get(pageId)?.status() ?? { pageId, open: false };
    }

    return [...this.sessions.values()].map((session) => session.status());
  }

  stopAll(): unknown {
    const stopped = [];
    for (const [pageId, session] of this.sessions) {
      session.close();
      stopped.push(pageId);
    }
    this.sessions.clear();
    return { stopped };
  }

  private getOrCreate(pageId: number): DiagnosticSession {
    const existing = this.sessions.get(pageId);
    if (existing?.isOpen) {
      return existing;
    }

    const session = new DiagnosticSession(pageId, buildWebsocketUrl(this.options.debuggerUrl, pageId), this.options.timeoutMs);
    this.sessions.set(pageId, session);
    return session;
  }

  private async ready(pageId: number): Promise<DiagnosticSession> {
    const session = this.getOrCreate(pageId);
    await session.ensureOpen();
    return session;
  }

  private async withSession<T>(pageId: number, fn: (session: DiagnosticSession) => Promise<T> | T): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const session = this.getOrCreate(pageId);
      try {
        await session.ensureOpen();
        return await fn(session);
      } catch (error) {
        lastError = error;
        if (attempt === 0 && isRetriableInspectorError(error)) {
          session.close();
          this.sessions.delete(pageId);
          continue;
        }
        throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async inspectSelectorProbe(pageId: number, selector: string): Promise<unknown> {
    try {
      return await inspectSelector(
        {
          debuggerUrl: this.options.debuggerUrl,
          pageId,
          timeoutMs: this.options.timeoutMs
        },
        {
          selector,
          includeComputedStyle: true,
          includeMatchedRules: false,
          includeOuterHtml: true
        }
      );
    } catch (error) {
      return { selector, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async resourceProbe(pageId: number, url: string): Promise<unknown> {
    try {
      return await probeResource(
        {
          debuggerUrl: this.options.debuggerUrl,
          pageId,
          timeoutMs: this.options.timeoutMs,
          hostCorrelation: this.options.hostCorrelation
        },
        {
          url,
          includeContent: true,
          includeNetwork: true,
          network: await this.networkForUrl(pageId, url)
        }
      );
    } catch (error) {
      return { url, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async imageProbe(pageId: number, url: string): Promise<unknown> {
    try {
      return await probeImage(
        {
          debuggerUrl: this.options.debuggerUrl,
          pageId,
          timeoutMs: this.options.timeoutMs,
          hostCorrelation: this.options.hostCorrelation
        },
        {
          url,
          timeoutMs: Math.min(this.options.timeoutMs, 5000),
          includeResourceProbe: true,
          network: await this.networkForUrl(pageId, url)
        }
      );
    } catch (error) {
      return { url, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export class DiagnosticSession {
  private socket?: WebSocket;
  private commandId = 1;
  private opened = false;
  private closed = false;
  private pending = new Map<number, PendingCommand>();
  private eventSequence = 0;
  private readonly events: DiagnosticEvent[] = [];
  private readonly capability = new Map<string, boolean>();
  private lastCommandResult?: InspectorCommandResult;
  private startup?: ReturnType<typeof summarizeStartupCommandResults>;

  constructor(
    readonly pageId: number,
    readonly websocketUrl: string,
    private readonly timeoutMs: number,
    private readonly maxEvents = 5000
  ) {}

  get isOpen(): boolean {
    return this.opened && !this.closed && this.socket?.readyState === WebSocket.OPEN;
  }

  async ensureOpen(): Promise<void> {
    if (this.isOpen) {
      return;
    }

    this.closed = false;
    this.socket = new WebSocket(this.websocketUrl);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out after ${this.timeoutMs}ms opening diagnostic session`)), this.timeoutMs);
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
      this.socket?.on("close", () => this.closePending("Diagnostic session closed"));
    });

    const startupResults: StartupCommandResult[] = [];
    for (const method of DEFAULT_ENABLE_COMMANDS) {
      const result = await this.tryCommand(method);
      startupResults.push({ method, ok: result.ok, error: result.error });
    }
    this.startup = summarizeStartupCommandResults(startupResults);
  }

  async command(method: string, params?: object | undefined): Promise<InspectorCommandResult> {
    if (!this.isOpen || !this.socket) {
      throw new Error("Diagnostic session is not open");
    }

    const id = this.commandId++;
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out after ${this.timeoutMs}ms waiting for ${method}`));
      }, this.timeoutMs);

      this.pending.set(id, { method, timeout, resolve, reject });
      this.socket?.send(JSON.stringify({ id, method, params: params ?? {} }));
    });
  }

  async tryCommand(method: string, params?: object | undefined): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    if (this.capability.get(method) === false) {
      return { ok: false, error: `${method} is not supported by this Coherent WebInspector target` };
    }

    let result: InspectorCommandResult;
    try {
      result = await this.command(method, params);
    } catch (error) {
      this.capability.set(method, false);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    if (result.response.error) {
      this.capability.set(method, false);
      return { ok: false, error: result.response.error.message };
    }

    this.capability.set(method, true);
    return { ok: true, result: result.response.result ?? {} };
  }

  status(): Record<string, unknown> {
    return {
      pageId: this.pageId,
      websocketUrl: this.websocketUrl,
      open: this.isOpen,
      eventCount: this.events.length,
      lastEventSequence: this.eventSequence,
      startup: this.startup,
      supported: this.supportedCommands(),
      unsupported: this.unsupportedCommands()
    };
  }

  listEvents(options: EventFilter): DiagnosticEvent[] {
    const since = options.sinceSequence ?? 0;
    const max = options.maxEvents ?? 100;
    const eventTypes = new Set(options.eventTypes ?? []);
    return this.events
      .filter((event) => event.sequence > since)
      .filter((event) => eventTypes.size === 0 || eventTypes.has(event.method))
      .slice(-max);
  }

  supportedCommands(): string[] {
    return [...this.capability.entries()].filter(([, ok]) => ok).map(([method]) => method);
  }

  unsupportedCommands(): string[] {
    return [...this.capability.entries()].filter(([, ok]) => !ok).map(([method]) => method);
  }

  async lastResponse(): Promise<InspectorCommandResult | undefined> {
    return this.lastCommandResult;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.opened = false;
    this.closePending("Diagnostic session closed");
    closeWebSocketSafely(this.socket);
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
    const result = { response: message, events: [] };
    this.lastCommandResult = result;
    pending.resolve(result);
  }

  private recordEvent(event: InspectorEvent): void {
    this.events.push({
      ...event,
      sequence: ++this.eventSequence,
      timestamp: new Date().toISOString(),
      rawId: `event:${this.eventSequence}`
    });
    while (this.events.length > this.maxEvents) {
      this.events.shift();
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

export function buildPageHealthExpression(sampleMs: number): string {
  const boundedSampleMs = Math.max(0, Math.min(sampleMs, 5000));
  return `(() => {
  var key = "__coherentgtMcpHealth";
  var state = window[key] || { rafFrames: 0, started: false };
  window[key] = state;
  var rafAvailable = typeof requestAnimationFrame === "function";
  function tick() {
    state.rafFrames += 1;
    if (rafAvailable) requestAnimationFrame(tick);
  }
  if (rafAvailable && !state.started) {
    state.started = true;
    requestAnimationFrame(tick);
  }
  return {
    title: document.title,
    href: location.href,
    readyState: document.readyState,
    visibilityState: document.visibilityState,
    hasFocus: typeof document.hasFocus === "function" ? document.hasFocus() : null,
    rafAvailable: rafAvailable,
    rafFrames: state.rafFrames,
    sampledAt: Date.now(),
    requestedSampleMs: ${boundedSampleMs}
  };
})()`;
}

export function buildRuntimeProbeExpression(paths: string[]): string {
  return `(() => {
  var paths = ${JSON.stringify(paths)};
  var output = {};
  function readPath(path) {
    var normalized = path.indexOf("window.") === 0 ? path.slice(7) : path.indexOf("global" + "This.") === 0 ? path.slice(11) : path;
    var parts = normalized.split(".");
    var value = window;
    for (var i = 0; i < parts.length; i += 1) {
      if (value == null) return { exists: false, value: null, type: "undefined" };
      value = value[parts[i]];
    }
    return { exists: value !== undefined, value: value, type: typeof value };
  }
  for (var i = 0; i < paths.length; i += 1) output[paths[i]] = readPath(paths[i]);
  return output;
})()`;
}

export function buildEventListenerProbeExpression(selector: string): string {
  return `(() => {
  var node = ${buildNodeReferenceExpression(selector)};
  if (!node) return { found: false, handlers: [] };
  var names = ["click", "input", "change", "keydown", "keyup", "mousedown", "mouseup", "panelActive", "panelInactive"];
  var handlers = [];
  for (var i = 0; i < names.length; i += 1) {
    var property = "on" + names[i];
    if (typeof node[property] === "function") handlers.push({ eventName: names[i], source: "dom-property" });
  }
  return { found: true, handlers: handlers };
})()`;
}

function buildNodeReferenceExpression(selector: string): string {
  if (selector === "document") {
    return "document";
  }
  if (selector === "window") {
    return "window";
  }
  return `document.querySelector(${JSON.stringify(selector)})`;
}

export function summarizeConsoleEvents(
  events: DiagnosticEvent[],
  options: { levels?: string[] | undefined; maxEvents: number; textContains?: string | undefined }
): { count: number; messages: unknown[] } {
  const levels = new Set((options.levels ?? []).map((level) => level.toLowerCase()));
  const textNeedle = options.textContains?.toLowerCase();
  const messages = [];
  for (const event of events) {
    if (event.method !== "Console.messageAdded") {
      continue;
    }
    const message = readRecord(readRecord(event.params).message);
    const level = stringOrUndefined(message.level) ?? "unknown";
    const text = stringOrUndefined(message.text) ?? stringOrUndefined(message.message) ?? "";
    if (levels.size > 0 && !levels.has(level.toLowerCase())) {
      continue;
    }
    if (textNeedle && !text.toLowerCase().includes(textNeedle)) {
      continue;
    }
    messages.push({
      sequence: event.sequence,
      timestamp: event.timestamp,
      level,
      text,
      url: stringOrUndefined(message.url),
      line: numberOrUndefined(message.line),
      column: numberOrUndefined(message.column),
      rawId: event.rawId
    });
  }
  return {
    count: messages.length,
    messages: messages.slice(-options.maxEvents)
  };
}

export function summarizeRuntimeErrors(events: DiagnosticEvent[], options: { maxEvents: number }): { count: number; errors: unknown[] } {
  const errors = [];
  for (const event of events) {
    if (event.method !== "Runtime.exceptionThrown") {
      continue;
    }
    const details = readRecord(readRecord(event.params).exceptionDetails);
    const stackTrace = readRecord(details.stackTrace);
    errors.push({
      sequence: event.sequence,
      timestamp: event.timestamp,
      text: stringOrUndefined(details.text) ?? "Runtime exception",
      url: stringOrUndefined(details.url),
      line: numberOrUndefined(details.line),
      column: numberOrUndefined(details.column),
      stackFrames: Array.isArray(stackTrace.callFrames) ? stackTrace.callFrames : [],
      rawId: event.rawId
    });
  }
  return {
    count: errors.length,
    errors: errors.slice(-options.maxEvents)
  };
}

export function summarizeNetworkEvents(
  events: DiagnosticEvent[],
  options: { maxPayloadChars: number }
): { requestCount: number; webSocketCount: number; requests: unknown[]; webSockets: unknown[] } {
  const requests = new Map<string, Record<string, unknown>>();
  const webSockets = new Map<string, Record<string, unknown>>();

  for (const event of events) {
    if (!event.method.startsWith("Network.")) {
      continue;
    }
    const params = readRecord(event.params);
    const requestId = stringOrUndefined(params.requestId);
    if (!requestId) {
      continue;
    }

    if (event.method.startsWith("Network.webSocket")) {
      const socket = webSockets.get(requestId) ?? {
        requestId,
        state: "unknown",
        sentFrameCount: 0,
        receivedFrameCount: 0
      };
      webSockets.set(requestId, socket);
      const timestamp = numberOrUndefined(params.timestamp);
      if (timestamp !== undefined && socket.createdAt === undefined) {
        socket.createdAt = timestamp;
      }
      if (event.method === "Network.webSocketCreated") {
        socket.url = params.url;
        socket.state = "created";
      } else if (event.method === "Network.webSocketWillSendHandshakeRequest") {
        socket.state = "connecting";
      } else if (event.method === "Network.webSocketHandshakeResponseReceived") {
        socket.state = "open";
      } else if (event.method === "Network.webSocketClosed") {
        socket.state = "closed";
        socket.closedAt = timestamp;
      } else if (event.method === "Network.webSocketFrameSent") {
        socket.sentFrameCount = numberValue(socket.sentFrameCount) + 1;
        socket.lastSent = frameSummary(params, event.rawId, options.maxPayloadChars);
      } else if (event.method === "Network.webSocketFrameReceived") {
        socket.receivedFrameCount = numberValue(socket.receivedFrameCount) + 1;
        socket.lastReceived = frameSummary(params, event.rawId, options.maxPayloadChars);
      } else if (event.method === "Network.webSocketFrameError") {
        socket.state = "error";
        socket.lastError = stringOrUndefined(params.errorMessage);
      }
      continue;
    }

    const row = requests.get(requestId) ?? { requestId, dataLength: 0, encodedDataLength: 0 };
    requests.set(requestId, row);
    if (event.method === "Network.requestWillBeSent") {
      const request = readRecord(params.request);
      row.url = request.url;
      row.method = request.method;
      row.type = params.type;
      row.startTime = numberOrUndefined(params.timestamp);
    } else if (event.method === "Network.responseReceived") {
      const response = readRecord(params.response);
      row.status = response.status;
      row.statusText = response.statusText;
      row.mimeType = response.mimeType;
      row.responseTime = numberOrUndefined(params.timestamp);
      row.url = response.url ?? row.url;
    } else if (event.method === "Network.loadingFailed") {
      row.failed = true;
      row.errorText = params.errorText;
      row.endTime = numberOrUndefined(params.timestamp);
    } else if (event.method === "Network.loadingFinished") {
      row.endTime = numberOrUndefined(params.timestamp);
    } else if (event.method === "Network.dataReceived") {
      row.dataLength = numberValue(row.dataLength) + numberValue(params.dataLength);
      row.encodedDataLength = numberValue(row.encodedDataLength) + numberValue(params.encodedDataLength);
    }
  }

  return {
    requestCount: requests.size,
    webSocketCount: webSockets.size,
    requests: [...requests.values()].map(compactUndefined),
    webSockets: [...webSockets.values()].map(compactUndefined)
  };
}

function selectPage(
  debuggerUrl: string,
  views: Array<{ id: number; title: string; url: string; inspectorUrl: string; websocketUrl: string }>,
  pageId: number | undefined,
  pageFilter: string | { titleContains?: string | undefined; urlContains?: string | undefined } | undefined
): PageSummary {
  if (pageId !== undefined) {
    const view = views.find((candidate) => candidate.id === pageId);
    if (!view) {
      throw new Error(`No CoherentGT page matched pageId ${pageId}`);
    }
    return toPageSummary(debuggerUrl, view);
  }

  const filter = typeof pageFilter === "string" ? { titleContains: pageFilter } : pageFilter ?? {};
  const matches = filterInspectableViews(views, filter);
  if (matches.length === 0) {
    throw new Error("No CoherentGT page matched the requested filter");
  }
  return toPageSummary(debuggerUrl, matches[0]!);
}

function summarizeResourceTree(value: unknown): unknown {
  const resources = collectResources(readRecord(value).frameTree);
  return {
    documentCount: resources.filter((resource) => resource.type === "Document").length,
    scriptCount: resources.filter((resource) => resource.type === "Script").length,
    stylesheetCount: resources.filter((resource) => resource.type === "Stylesheet").length,
    sourceMapCount: resources.filter((resource) => typeof resource.sourceMapURL === "string").length,
    resources
  };
}

function collectResources(frameTree: unknown): Array<Record<string, unknown>> {
  const tree = readRecord(frameTree);
  const resources = Array.isArray(tree.resources) ? tree.resources.map(readRecord) : [];
  const childFrames = Array.isArray(tree.childFrames) ? tree.childFrames : [];
  for (const child of childFrames) {
    resources.push(...collectResources(child));
  }
  return resources.map((resource) =>
    compactUndefined({
      url: resource.url,
      type: resource.type,
      mimeType: resource.mimeType,
      sourceMapURL: resource.sourceMapURL
    })
  );
}

function buildLikelyCauses(
  consoleSummary: { count: number },
  runtimeErrors: { count: number },
  health: unknown,
  network: { webSocketCount: number },
  probes: { selectors: unknown[]; resourceProbes: unknown[]; imageProbes: unknown[] }
): string[] {
  const causes = [];
  if (runtimeErrors.count > 0) {
    causes.push("Runtime exceptions were observed after diagnostics attached.");
  }
  if (consoleSummary.count > 0) {
    causes.push("Console warnings or errors were observed after diagnostics attached.");
  }
  const healthValue = readRecord(readRecord(health).health).value;
  if (readRecord(healthValue).rafProgressed === false) {
    causes.push("requestAnimationFrame did not progress during the health sample.");
  }
  if (network.webSocketCount === 0) {
    causes.push("No WebSocket activity was observed after diagnostics attached.");
  }
  if (runtimeStatus(health).status === "timeout") {
    causes.push("Runtime.evaluate timed out; the main thread may be busy or the target may be rejecting Runtime commands.");
  }
  if (probes.selectors.some((entry) => readRecord(entry).found === false)) {
    causes.push("Requested selector did not match a DOM node.");
  }
  if (probes.resourceProbes.some((entry) => readRecord(entry).foundInResourceTree === false)) {
    causes.push("Requested resource was not present in Page.getResourceTree.");
  }
  if (probes.imageProbes.some((entry) => ["request-failed", "decode-failed"].includes(String(readRecord(entry).verdict)))) {
    causes.push("Image request failed or did not decode.");
  }
  return causes;
}

function runtimeStatus(health: unknown): { status: "success" | "timeout" | "unsupported" | "not-probed"; likelyCause?: string | undefined } {
  const value = readRecord(readRecord(health).health);
  if (Object.keys(value).length === 0) {
    return { status: "not-probed" };
  }
  if (value.type === "timeout") {
    return { status: "timeout", likelyCause: stringOrUndefined(value.likelyCause) };
  }
  if (value.type === "error") {
    return { status: "unsupported", likelyCause: stringOrUndefined(value.likelyCause) };
  }
  return { status: "success" };
}

function mergeHealthSamples(before: unknown, after: unknown, requestedSampleMs: number): unknown {
  const beforeRecord = readRecord(before);
  const afterRecord = readRecord(after);
  const beforeFrames = numberOrUndefined(beforeRecord.rafFrames) ?? 0;
  const afterFrames = numberOrUndefined(afterRecord.rafFrames) ?? 0;
  const beforeSampledAt = numberOrUndefined(beforeRecord.sampledAt);
  const afterSampledAt = numberOrUndefined(afterRecord.sampledAt);

  return {
    ...afterRecord,
    rafFramesBefore: beforeFrames,
    rafFramesAfter: afterFrames,
    rafFramesDelta: Math.max(0, afterFrames - beforeFrames),
    rafProgressed: afterFrames > beforeFrames,
    sampleMs:
      beforeSampledAt !== undefined && afterSampledAt !== undefined && afterSampledAt >= beforeSampledAt
        ? afterSampledAt - beforeSampledAt
        : requestedSampleMs
  };
}

function frameSummary(params: Record<string, unknown>, rawId: string, maxPayloadChars: number): Record<string, unknown> {
  const response = readRecord(params.response);
  const payload = stringOrUndefined(response.payloadData) ?? "";
  return {
    timestamp: numberOrUndefined(params.timestamp),
    opcode: response.opcode,
    payload: payload.slice(0, maxPayloadChars),
    truncated: payload.length > maxPayloadChars,
    rawId
  };
}

function isInspectorResponse(value: unknown): value is InspectorCommandResponse {
  return !!value && typeof value === "object" && typeof (value as { id?: unknown }).id === "number";
}

function isInspectorEvent(value: unknown): value is InspectorEvent {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { method?: unknown }).method === "string" &&
    (value as { id?: unknown }).id === undefined
  );
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function compactUndefined(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      output[key] = entry;
    }
  }
  return output;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function summarizeStartupCommandResults(results: StartupCommandResult[]): {
  supported: string[];
  unsupported: string[];
  errors: Array<{ method: string; error: string }>;
} {
  return {
    supported: results.filter((entry) => entry.ok).map((entry) => entry.method),
    unsupported: results.filter((entry) => !entry.ok).map((entry) => entry.method),
    errors: results
      .filter((entry): entry is StartupCommandResult & { error: string } => !entry.ok && typeof entry.error === "string")
      .map((entry) => ({ method: entry.method, error: entry.error }))
  };
}
