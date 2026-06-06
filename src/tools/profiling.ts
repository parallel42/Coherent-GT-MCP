import WebSocket from "ws";
import { buildWebsocketUrl } from "../coherent/debugger-client.js";
import { isRetriableInspectorError } from "../coherent/inspector-client.js";
import type { InspectorCommandResponse, InspectorEvent } from "../coherent/protocol.js";
import { closeWebSocketSafely } from "../coherent/websocket-lifecycle.js";

export type CaptureInstrument = "timeline" | "script" | "network" | "heap" | "layerTree";
export type TimelineInstrument = "Timeline" | "ScriptProfiler" | "Memory" | "Heap";

export type ProfilingEvent = InspectorEvent & {
  sequence: number;
  timestamp: string;
  captureId: string | null;
  rawId: string;
};

export type RawArtifact = {
  rawId: string;
  kind: "heap-snapshot" | "script-samples" | "event-payload";
  createdAt: string;
  byteLength: number;
  value: unknown;
};

type PendingCommand = {
  method: string;
  timeout: NodeJS.Timeout;
  resolve: (response: InspectorCommandResponse) => void;
  reject: (error: Error) => void;
};

type ManagerOptions = {
  debuggerUrl: string;
  timeoutMs: number;
};

type StartOptions = {
  instruments: CaptureInstrument[];
  reload?: boolean | undefined;
  ignoreCache?: boolean | undefined;
  maxCallStackDepth?: number | undefined;
  timelineInstruments?: TimelineInstrument[] | undefined;
};

type EventListOptions = {
  sinceSequence?: number | undefined;
  maxEvents?: number | undefined;
  eventTypes?: string[] | undefined;
  includeParams?: boolean | undefined;
};

const DEFAULT_TIMELINE_INSTRUMENTS: TimelineInstrument[] = ["Timeline", "ScriptProfiler", "Memory", "Heap"];
const ALL_INSTRUMENTS: CaptureInstrument[] = ["timeline", "script", "network", "heap", "layerTree"];

export class ProfilingSessionManager {
  private readonly sessions = new Map<number, ProfilingSession>();

  constructor(private readonly options: ManagerOptions) {}

  async start(pageId: number, options: StartOptions): Promise<unknown> {
    const session = this.getOrCreate(pageId);
    try {
      return await session.start(options);
    } catch (error) {
      this.releaseFailedSession(pageId, session, error);
      throw error;
    }
  }

  async startAll(pageId: number, options: Omit<StartOptions, "instruments">): Promise<unknown> {
    return await this.start(pageId, { ...options, instruments: ALL_INSTRUMENTS });
  }

  async stop(pageId: number, instruments?: CaptureInstrument[] | undefined): Promise<unknown> {
    const session = this.require(pageId);
    try {
      return await session.stop(instruments);
    } catch (error) {
      this.releaseFailedSession(pageId, session, error);
      throw error;
    }
  }

  status(pageId?: number | undefined): unknown {
    if (pageId !== undefined) {
      return this.sessions.get(pageId)?.status() ?? { pageId, open: false };
    }

    return [...this.sessions.values()].map((session) => session.status());
  }

  release(pageId: number): unknown {
    const session = this.sessions.get(pageId);
    if (!session) {
      return { pageId, released: false, reason: "No active profiling session" };
    }

    session.close();
    this.sessions.delete(pageId);
    return { pageId, released: true };
  }

  events(pageId: number, options: EventListOptions): unknown {
    return this.require(pageId).events(options);
  }

  raw(pageId: number, rawId: string): unknown {
    return this.require(pageId).raw(rawId);
  }

  async heapSnapshot(pageId: number): Promise<unknown> {
    const session = this.getOrCreate(pageId);
    try {
      return await session.heapSnapshot();
    } catch (error) {
      this.releaseFailedSession(pageId, session, error);
      throw error;
    }
  }

  async heapGc(pageId: number): Promise<unknown> {
    const session = this.getOrCreate(pageId);
    try {
      return await session.sendCommand("Heap.gc");
    } catch (error) {
      this.releaseFailedSession(pageId, session, error);
      throw error;
    }
  }

  async layerTree(pageId: number, input: { nodeId?: number | undefined; selector?: string | undefined }): Promise<unknown> {
    const session = this.getOrCreate(pageId);
    try {
      await session.ensureOpen();
      await session.tryCommand("LayerTree.enable");

      const nodeId = input.nodeId ?? (input.selector ? await session.resolveNodeId(input.selector) : undefined);
      if (nodeId === undefined) {
        return {
          pageId,
          enabled: true,
          message: "LayerTree enabled. Supply nodeId or selector to call LayerTree.layersForNode."
        };
      }

      return await session.sendCommand("LayerTree.layersForNode", { nodeId });
    } catch (error) {
      this.releaseFailedSession(pageId, session, error);
      throw error;
    }
  }

  async compositingReasons(pageId: number, layerId: string): Promise<unknown> {
    const session = this.getOrCreate(pageId);
    try {
      await session.ensureOpen();
      await session.tryCommand("LayerTree.enable");
      return await session.sendCommand("LayerTree.reasonsForCompositingLayer", { layerId });
    } catch (error) {
      this.releaseFailedSession(pageId, session, error);
      throw error;
    }
  }

  async setPaintRectsVisible(pageId: number, visible: boolean): Promise<unknown> {
    const session = this.getOrCreate(pageId);
    try {
      return await session.sendCommand("Page.setShowPaintRects", { result: visible });
    } catch (error) {
      this.releaseFailedSession(pageId, session, error);
      throw error;
    }
  }

  async setCompositingBordersVisible(pageId: number, visible: boolean): Promise<unknown> {
    const session = this.getOrCreate(pageId);
    try {
      return await session.sendCommand("Page.setCompositingBordersVisible", { visible });
    } catch (error) {
      this.releaseFailedSession(pageId, session, error);
      throw error;
    }
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

  private getOrCreate(pageId: number): ProfilingSession {
    const existing = this.sessions.get(pageId);
    if (existing?.isOpen) {
      return existing;
    }

    const session = new ProfilingSession(pageId, buildWebsocketUrl(this.options.debuggerUrl, pageId), this.options.timeoutMs);
    this.sessions.set(pageId, session);
    return session;
  }

  private require(pageId: number): ProfilingSession {
    const session = this.sessions.get(pageId);
    if (!session?.isOpen) {
      throw new Error(`No active profiling session for pageId ${pageId}; start a capture first`);
    }

    return session;
  }

  private releaseFailedSession(pageId: number, session: ProfilingSession, error: unknown): void {
    if (!isRetriableInspectorError(error)) {
      return;
    }

    session.close();
    if (this.sessions.get(pageId) === session) {
      this.sessions.delete(pageId);
    }
  }
}

export class ProfilingSession {
  private socket?: WebSocket;
  private commandId = 1;
  private opened = false;
  private closed = false;
  private captureCounter = 0;
  private captureId: string | null = null;
  private captureStartedAt: string | null = null;
  private pending = new Map<number, PendingCommand>();
  private eventSequence = 0;
  private readonly eventsBuffer: ProfilingEvent[] = [];
  private readonly rawArtifacts = new Map<string, RawArtifact>();
  private readonly activeInstruments = new Set<CaptureInstrument>();
  private readonly capabilities = new Map<string, boolean>();

  constructor(
    readonly pageId: number,
    readonly websocketUrl: string,
    private readonly timeoutMs: number,
    private readonly maxEvents = 5000,
    private readonly maxArtifacts = 20
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
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out after ${this.timeoutMs}ms opening profiling session`));
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
      this.socket?.on("close", () => this.handleSocketClosed());
    });

    await this.tryCommand("Page.enable");
    await this.tryCommand("Runtime.enable");
  }

  async start(options: StartOptions): Promise<unknown> {
    await this.ensureOpen();

    if (this.activeInstruments.size === 0) {
      this.resetCapture();
    }

    const requested = uniqueInstruments(options.instruments);
    const started: string[] = [];
    const unsupported: Array<{ instrument: string; error: string }> = [];

    for (const instrument of requested) {
      if (this.activeInstruments.has(instrument)) {
        continue;
      }

      try {
        await this.startInstrument(instrument, options);
        this.activeInstruments.add(instrument);
        started.push(instrument);
      } catch (error) {
        unsupported.push({
          instrument,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (options.reload) {
      await this.sendCommand("Page.reload", { ignoreCache: options.ignoreCache ?? false });
    }

    return {
      pageId: this.pageId,
      captureId: this.captureId,
      started,
      activeInstruments: [...this.activeInstruments],
      unsupported,
      reloaded: options.reload ?? false
    };
  }

  async stop(instruments?: CaptureInstrument[] | undefined): Promise<unknown> {
    await this.ensureOpen();
    const targets = instruments ? uniqueInstruments(instruments) : [...this.activeInstruments];
    const stopped: string[] = [];
    const errors: Array<{ instrument: string; error: string }> = [];

    for (const instrument of targets) {
      if (!this.activeInstruments.has(instrument)) {
        continue;
      }

      try {
        await this.stopInstrument(instrument);
        this.activeInstruments.delete(instrument);
        stopped.push(instrument);
      } catch (error) {
        errors.push({
          instrument,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    await delay(100);

    return {
      pageId: this.pageId,
      captureId: this.captureId,
      stopped,
      activeInstruments: [...this.activeInstruments],
      errors,
      summary: this.summary()
    };
  }

  async heapSnapshot(): Promise<unknown> {
    await this.ensureOpen();
    await this.tryCommand("Heap.enable");
    const result = await this.sendCommand("Heap.snapshot");
    const snapshotData = readRecord(result).snapshotData;
    const timestamp = readRecord(result).timestamp;
    const rawId = this.rememberRaw("heap-snapshot", snapshotData ?? result);

    return {
      pageId: this.pageId,
      captureId: this.captureId,
      rawId,
      timestamp: typeof timestamp === "number" ? timestamp : null,
      byteLength: this.rawArtifacts.get(rawId)?.byteLength ?? 0,
      valid: typeof snapshotData === "string" && snapshotData.length > 0
    };
  }

  async sendCommand(method: string, params?: object | undefined): Promise<unknown> {
    await this.ensureOpen();
    const response = await this.command(method, params);
    if (response.error) {
      throw new Error(`${method} failed: ${response.error.message}`);
    }

    return response.result ?? {};
  }

  async tryCommand(method: string, params?: object | undefined): Promise<{ ok: boolean; error?: string }> {
    const cached = this.capabilities.get(method);
    if (cached === false) {
      return { ok: false, error: `${method} is not supported by this Coherent WebInspector target` };
    }

    const response = await this.command(method, params);
    if (response.error) {
      this.capabilities.set(method, false);
      return { ok: false, error: response.error.message };
    }

    this.capabilities.set(method, true);
    return { ok: true };
  }

  async resolveNodeId(selector: string): Promise<number> {
    const documentResult = readRecord(await this.sendCommand("DOM.getDocument"));
    const root = readRecord(documentResult.root);
    const rootNodeId = root.nodeId;
    if (typeof rootNodeId !== "number") {
      throw new Error("DOM.getDocument did not return a root node id");
    }

    const queryResult = readRecord(await this.sendCommand("DOM.querySelector", { nodeId: rootNodeId, selector }));
    const nodeId = queryResult.nodeId;
    if (typeof nodeId !== "number" || nodeId <= 0) {
      throw new Error(`No node matched selector: ${selector}`);
    }

    return nodeId;
  }

  status(): Record<string, unknown> {
    return {
      pageId: this.pageId,
      websocketUrl: this.websocketUrl,
      open: this.isOpen,
      captureId: this.captureId,
      captureStartedAt: this.captureStartedAt,
      activeInstruments: [...this.activeInstruments],
      eventCount: this.eventsBuffer.length,
      rawArtifactCount: this.rawArtifacts.size,
      lastEventSequence: this.eventSequence,
      summary: this.summary()
    };
  }

  events(options: EventListOptions): unknown {
    const since = options.sinceSequence ?? 0;
    const max = options.maxEvents ?? 100;
    const eventTypes = new Set(options.eventTypes ?? []);
    return this.eventsBuffer
      .filter((event) => event.sequence > since)
      .filter((event) => eventTypes.size === 0 || eventTypes.has(event.method))
      .slice(-max)
      .map((event) => {
        const entry: Record<string, unknown> = {
          sequence: event.sequence,
          timestamp: event.timestamp,
          captureId: event.captureId,
          method: event.method,
          rawId: event.rawId
        };
        if (options.includeParams) {
          entry.params = event.params ?? null;
        }
        return entry;
      });
  }

  raw(rawId: string): unknown {
    const artifact = this.rawArtifacts.get(rawId);
    if (artifact) {
      return artifact;
    }

    const event = this.eventsBuffer.find((candidate) => candidate.rawId === rawId);
    if (event) {
      return event;
    }

    throw new Error(`No profiling raw payload found for rawId ${rawId}`);
  }

  close(): void {
    const wasClosed = this.closed;
    this.closed = true;
    this.opened = false;
    this.activeInstruments.clear();
    if (!wasClosed) {
      this.closePending("Profiling session closed");
    }
    closeWebSocketSafely(this.socket);
  }

  handleSocketClosed(): void {
    this.opened = false;
    this.closed = true;
    this.activeInstruments.clear();
    this.closePending("Profiling session closed");
  }

  private async command(method: string, params?: object | undefined, timeoutMs = this.timeoutMs): Promise<InspectorCommandResponse> {
    if (!this.isOpen || !this.socket) {
      throw new Error("Profiling session is not open");
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

  private async startInstrument(instrument: CaptureInstrument, options: StartOptions): Promise<void> {
    if (instrument === "timeline") {
      const timelineInstruments = options.timelineInstruments ?? DEFAULT_TIMELINE_INSTRUMENTS;
      const configured = await this.tryCommand("Timeline.setInstruments", { instruments: timelineInstruments });
      if (!configured.ok) {
        throw new Error(configured.error);
      }
      await this.sendCommand("Timeline.start", { maxCallStackDepth: options.maxCallStackDepth ?? 128 });
      return;
    }

    if (instrument === "script") {
      await this.sendCommand("ScriptProfiler.startTracking", { includeSamples: true });
      return;
    }

    if (instrument === "network") {
      await this.sendCommand("Network.enable");
      return;
    }

    if (instrument === "heap") {
      try {
        await this.sendCommand("Heap.enable");
        await this.sendCommand("Heap.startTracking");
      } catch (error) {
        throw new Error(`Heap tracking is not supported by this Coherent target: ${errorMessage(error)}`);
      }
      return;
    }

    if (instrument === "layerTree") {
      await this.sendCommand("LayerTree.enable");
    }
  }

  private async stopInstrument(instrument: CaptureInstrument): Promise<void> {
    if (instrument === "timeline") {
      await this.sendCommand("Timeline.stop");
      return;
    }

    if (instrument === "script") {
      await this.sendCommand("ScriptProfiler.stopTracking");
      return;
    }

    if (instrument === "network") {
      await this.tryCommand("Network.disable");
      return;
    }

    if (instrument === "heap") {
      await this.sendCommand("Heap.stopTracking");
      return;
    }

    if (instrument === "layerTree") {
      await this.tryCommand("LayerTree.disable");
    }
  }

  private resetCapture(): void {
    this.eventsBuffer.length = 0;
    this.rawArtifacts.clear();
    this.captureId = `${this.pageId}-${Date.now()}-${++this.captureCounter}`;
    this.captureStartedAt = new Date().toISOString();
  }

  private summary(): Record<string, unknown> {
    return {
      network: buildNetworkWaterfall(this.eventsBuffer),
      timeline: buildTimelineSummary(this.eventsBuffer),
      script: buildScriptProfileSummary(this.eventsBuffer, this.rawArtifacts),
      heap: buildHeapSummary(this.eventsBuffer, this.rawArtifacts),
      layers: buildLayerSummary(this.eventsBuffer)
    };
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
    pending.resolve(message);
  }

  private recordEvent(event: InspectorEvent): void {
    const rawId = `event:${this.eventSequence + 1}`;
    const debugEvent: ProfilingEvent = {
      ...event,
      sequence: ++this.eventSequence,
      timestamp: new Date().toISOString(),
      captureId: this.captureId,
      rawId
    };
    this.eventsBuffer.push(debugEvent);
    while (this.eventsBuffer.length > this.maxEvents) {
      this.eventsBuffer.shift();
    }

    this.rememberEventArtifacts(debugEvent);
  }

  private rememberEventArtifacts(event: ProfilingEvent): void {
    const params = readRecord(event.params);
    if (event.method === "Heap.trackingStart" || event.method === "Heap.trackingComplete") {
      const rawId = this.rememberRaw("heap-snapshot", params.snapshotData ?? params.snapshotStringData ?? params);
      params.rawId = rawId;
    }

    if (event.method === "Console.heapSnapshot") {
      const rawId = this.rememberRaw("heap-snapshot", params.snapshotData ?? params.snapshotStringData ?? params);
      params.rawId = rawId;
    }

    if (event.method === "ScriptProfiler.trackingComplete") {
      const rawId = this.rememberRaw("script-samples", params.samples ?? params);
      params.rawId = rawId;
    }
  }

  private rememberRaw(kind: RawArtifact["kind"], value: unknown): string {
    const rawId = `${kind}:${Date.now()}:${this.rawArtifacts.size + 1}`;
    const artifact: RawArtifact = {
      rawId,
      kind,
      createdAt: new Date().toISOString(),
      byteLength: Buffer.byteLength(JSON.stringify(value ?? null), "utf8"),
      value
    };
    this.rawArtifacts.set(rawId, artifact);
    while (this.rawArtifacts.size > this.maxArtifacts) {
      const firstKey = this.rawArtifacts.keys().next().value as string | undefined;
      if (!firstKey) {
        break;
      }
      this.rawArtifacts.delete(firstKey);
    }
    return rawId;
  }

  private closePending(message: string): void {
    for (const [, command] of this.pending) {
      clearTimeout(command.timeout);
      command.reject(new Error(`${message} while waiting for ${command.method}`));
    }
    this.pending.clear();
  }
}

export function buildNetworkWaterfall(events: ProfilingEvent[] | InspectorEvent[]): { requestCount: number; requests: unknown[] } {
  const rows = new Map<string, Record<string, unknown>>();

  for (const event of events) {
    if (!event.method.startsWith("Network.")) {
      continue;
    }

    const params = readRecord(event.params);
    const requestId = typeof params.requestId === "string" ? params.requestId : undefined;
    if (!requestId) {
      continue;
    }

    const row = rows.get(requestId) ?? { requestId, dataLength: 0, encodedDataLength: 0 };
    rows.set(requestId, row);

    if (event.method === "Network.requestWillBeSent") {
      const request = readRecord(params.request);
      const redirectResponse = readRecord(params.redirectResponse);
      row.url = request.url ?? row.url;
      row.method = request.method ?? row.method;
      row.type = params.type ?? row.type;
      row.startTime = numberOrUndefined(params.timestamp);
      row.documentURL = params.documentURL;
      row.redirected = Object.keys(redirectResponse).length > 0;
    } else if (event.method === "Network.responseReceived") {
      const response = readRecord(params.response);
      row.type = params.type ?? row.type;
      row.responseTime = numberOrUndefined(params.timestamp);
      row.status = response.status;
      row.statusText = response.statusText;
      row.mimeType = response.mimeType;
      row.url = response.url ?? row.url;
      if (response.source === "memory-cache" || response.source === "disk-cache") {
        row.fromCache = true;
      }
    } else if (event.method === "Network.dataReceived") {
      row.dataLength = numberValue(row.dataLength) + numberValue(params.dataLength);
      row.encodedDataLength = numberValue(row.encodedDataLength) + numberValue(params.encodedDataLength);
    } else if (event.method === "Network.loadingFinished") {
      row.endTime = numberOrUndefined(params.timestamp);
      const metrics = readRecord(params.metrics);
      row.metrics = Object.keys(metrics).length > 0 ? metrics : undefined;
    } else if (event.method === "Network.loadingFailed") {
      row.endTime = numberOrUndefined(params.timestamp);
      row.failed = true;
      row.canceled = params.canceled;
      row.errorText = params.errorText;
    } else if (event.method === "Network.requestServedFromMemoryCache") {
      const resource = readRecord(params.resource);
      row.fromMemoryCache = true;
      row.url = resource.url ?? row.url;
      row.type = resource.type ?? row.type;
      row.startTime = numberOrUndefined(params.timestamp);
    } else if (event.method.startsWith("Network.webSocket")) {
      row.webSocket = true;
      row.url = params.url ?? row.url;
      row.endTime = event.method === "Network.webSocketClosed" ? numberOrUndefined(params.timestamp) : row.endTime;
    }
  }

  const requests = [...rows.values()]
    .map((row) => {
      const startTime = numberOrUndefined(row.startTime);
      const responseTime = numberOrUndefined(row.responseTime);
      const endTime = numberOrUndefined(row.endTime);
      return {
        ...compactUndefined(row),
        latency: startTime !== undefined && responseTime !== undefined ? responseTime - startTime : undefined,
        receiveDuration: responseTime !== undefined && endTime !== undefined ? endTime - responseTime : undefined,
        duration: startTime !== undefined && endTime !== undefined ? endTime - startTime : undefined
      };
    })
    .sort((a, b) => numberValue((a as { startTime?: unknown }).startTime) - numberValue((b as { startTime?: unknown }).startTime));

  return {
    requestCount: requests.length,
    requests: requests.map(compactUndefined)
  };
}

export function buildTimelineSummary(events: ProfilingEvent[] | InspectorEvent[]): Record<string, unknown> {
  const counts: Record<string, number> = {};
  const durations: Record<string, number> = {};
  let recordCount = 0;

  for (const event of events) {
    if (event.method !== "Timeline.eventRecorded") {
      continue;
    }
    for (const record of flattenTimelineRecords(readRecord(event.params).record)) {
      const recordObject = readRecord(record);
      const type = String(recordObject.type ?? recordObject.eventType ?? "unknown");
      const group = classifyTimelineRecord(type);
      counts[group] = (counts[group] ?? 0) + 1;
      durations[group] = (durations[group] ?? 0) + timelineDuration(recordObject);
      recordCount++;
    }
  }

  return {
    recordCount,
    counts,
    durations
  };
}

export function buildScriptProfileSummary(
  events: ProfilingEvent[] | InspectorEvent[],
  artifacts: ReadonlyMap<string, RawArtifact> = new Map()
): Record<string, unknown> {
  let started = 0;
  let updates = 0;
  let completed = 0;
  let sampleCount = 0;
  const rawIds = new Set<string>();

  for (const event of events) {
    if (event.method === "ScriptProfiler.trackingStart") {
      started++;
    } else if (event.method === "ScriptProfiler.trackingUpdate") {
      updates++;
    } else if (event.method === "ScriptProfiler.trackingComplete") {
      completed++;
      const params = readRecord(event.params);
      const rawId = typeof params.rawId === "string" ? params.rawId : undefined;
      if (rawId) {
        rawIds.add(rawId);
      }
      const samples = readRecord(params.samples);
      const stackTraces = samples.stackTraces;
      if (Array.isArray(stackTraces)) {
        sampleCount += stackTraces.length;
      }
    }
  }

  for (const artifact of artifacts.values()) {
    if (artifact.kind === "script-samples") {
      rawIds.add(artifact.rawId);
    }
  }

  return {
    started,
    updates,
    completed,
    sampleCount,
    rawIds: [...rawIds]
  };
}

export function buildHeapSummary(
  events: ProfilingEvent[] | InspectorEvent[],
  artifacts: ReadonlyMap<string, RawArtifact> = new Map()
): Record<string, unknown> {
  let trackingStarts = 0;
  let trackingCompletes = 0;
  let garbageCollections = 0;
  const snapshots: Array<Record<string, unknown>> = [];

  for (const event of events) {
    if (event.method === "Heap.trackingStart") {
      trackingStarts++;
    } else if (event.method === "Heap.trackingComplete") {
      trackingCompletes++;
    } else if (event.method === "Heap.garbageCollected") {
      garbageCollections++;
    }
  }

  for (const artifact of artifacts.values()) {
    if (artifact.kind === "heap-snapshot") {
      snapshots.push({
        rawId: artifact.rawId,
        createdAt: artifact.createdAt,
        byteLength: artifact.byteLength,
        valid: artifact.byteLength > 0
      });
    }
  }

  return {
    trackingStarts,
    trackingCompletes,
    garbageCollections,
    snapshotCount: snapshots.length,
    snapshots
  };
}

export function buildLayerSummary(events: ProfilingEvent[] | InspectorEvent[]): Record<string, unknown> {
  return {
    layerTreeChangeCount: events.filter((event) => event.method === "LayerTree.layerTreeDidChange").length
  };
}

function uniqueInstruments(instruments: CaptureInstrument[]): CaptureInstrument[] {
  return [...new Set(instruments)];
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

function* flattenTimelineRecords(record: unknown): Generator<unknown> {
  if (!record || typeof record !== "object") {
    return;
  }

  yield record;
  const children = readRecord(record).children;
  if (Array.isArray(children)) {
    for (const child of children) {
      yield* flattenTimelineRecords(child);
    }
  }
}

function classifyTimelineRecord(type: string): string {
  if (type === "RenderingFrame") return "frame";
  if (type === "Layout" || type === "InvalidateLayout" || type === "RecalculateStyles" || type === "ScheduleStyleRecalculation") {
    return "layout";
  }
  if (type === "Paint" || type === "Composite") return "paint";
  if (type.includes("Resource")) return "network";
  if (type.includes("Timer") || type === "EvaluateScript" || type === "FunctionCall" || type === "EventDispatch") return "script";
  if (type.includes("GC") || type.includes("Garbage")) return "memory";
  return "other";
}

function timelineDuration(record: Record<string, unknown>): number {
  const start = numberOrUndefined(record.startTime);
  const end = numberOrUndefined(record.endTime);
  return start !== undefined && end !== undefined && end >= start ? end - start : 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
