import WebSocket from "ws";
import type { InspectorCommandResult, InspectorCommandResponse, InspectorEvent } from "./protocol.js";
import { closeWebSocketSafely } from "./websocket-lifecycle.js";

const DEFAULT_RELOAD_RECONNECT_TIMEOUT_MS = 30000;
const RELOAD_RECONNECT_PROBE_TIMEOUT_MS = 1000;
const RELOAD_RECONNECT_INITIAL_DELAY_MS = 100;
const RELOAD_RECONNECT_MAX_DELAY_MS = 1000;

export async function sendInspectorCommand(options: {
  websocketUrl: string;
  method: string;
  params?: object;
  timeoutMs: number;
  reconnectTimeoutMs?: number;
}): Promise<InspectorCommandResult> {
  const maxAttempts = 2;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await sendInspectorCommandOnce(options);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < maxAttempts && isRetriableInspectorError(error) && !isReloadReconnectError(error)) {
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function sendInspectorCommandOnce(options: {
  websocketUrl: string;
  method: string;
  params?: object;
  timeoutMs: number;
  reconnectTimeoutMs?: number;
}): Promise<InspectorCommandResult> {
  const commandId = 1;
  const events: InspectorEvent[] = [];

  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(options.websocketUrl);
    let settled = false;
    let sent = false;

    const finish = (error?: Error, result?: InspectorCommandResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      closeWebSocketSafely(socket);

      if (error) {
        reject(error);
      } else if (result) {
        resolve(result);
      } else {
        reject(new Error("Inspector command finished without a result"));
      }
    };

    const reloadClosedResult = (reconnected = false): InspectorCommandResult => ({
      response: {
        id: commandId,
        result: {
          reloaded: true,
          connectionClosed: true,
          reconnected
        }
      },
      events
    });

    const finishReloadAfterReconnect = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      closeWebSocketSafely(socket);
      waitForInspectorReconnect(options.websocketUrl, reloadReconnectTimeoutMs(options)).then(
        () => resolve(reloadClosedResult(true)),
        (error) => reject(new ReloadReconnectError(error instanceof Error ? error.message : String(error)))
      );
    };

    const timeout = setTimeout(() => {
      if (options.method === "Page.reload" && sent) {
        finishReloadAfterReconnect();
        return;
      }
      finish(new Error(`Timed out after ${options.timeoutMs}ms waiting for ${options.method}`));
    }, options.timeoutMs);

    socket.on("open", () => {
      sent = true;
      socket.send(
        JSON.stringify({
          id: commandId,
          method: options.method,
          params: options.params ?? {}
        }),
        (error) => {
          if (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
          }
        }
      );
    });

    socket.on("message", (data) => {
      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      if (isInspectorEvent(message)) {
        events.push(message);
        return;
      }

      if (isInspectorResponse(message) && message.id === commandId) {
        finish(undefined, {
          response: message,
          events
        });
      }
    });

    socket.on("error", (error) => {
      if (options.method === "Page.reload" && sent && isRetriableInspectorError(error)) {
        finishReloadAfterReconnect();
        return;
      }
      finish(error);
    });

    socket.on("close", () => {
      if (options.method === "Page.reload" && sent) {
        finishReloadAfterReconnect();
        return;
      }
      finish(new Error(`Inspector socket closed while waiting for ${options.method}`));
    });
  });
}

async function waitForInspectorReconnect(websocketUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  let retryDelayMs = RELOAD_RECONNECT_INITIAL_DELAY_MS;

  while (Date.now() < deadline) {
    try {
      await probeInspectorConnection(
        websocketUrl,
        Math.min(RELOAD_RECONNECT_PROBE_TIMEOUT_MS, Math.max(1, deadline - Date.now()))
      );
      return;
    } catch (error) {
      lastError = error;
      await delay(Math.min(retryDelayMs, Math.max(0, deadline - Date.now())));
      retryDelayMs = Math.min(retryDelayMs * 2, RELOAD_RECONNECT_MAX_DELAY_MS);
    }
  }

  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`Timed out after ${timeoutMs}ms waiting for inspector reconnect after Page.reload${detail}`);
}

async function probeInspectorConnection(websocketUrl: string, timeoutMs: number): Promise<void> {
  const probeCommandId = 1;
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(websocketUrl);
    let settled = false;

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      closeWebSocketSafely(socket);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const timeout = setTimeout(() => {
      finish(new Error(`Timed out after ${timeoutMs}ms waiting for inspector reconnect`));
    }, timeoutMs);

    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          id: probeCommandId,
          method: "Runtime.evaluate",
          params: {
            expression: "document.readyState",
            returnByValue: true
          }
        }),
        (error) => {
          if (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
          }
        }
      );
    });

    socket.on("message", (data) => {
      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      if (isInspectorResponse(message) && message.id === probeCommandId) {
        finish();
      }
    });

    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish(new Error("Inspector socket closed while reconnecting after Page.reload")));
  });
}

export async function withInspectorSession<T>(
  options: { websocketUrl: string; timeoutMs: number },
  callback: (send: (method: string, params?: object) => Promise<InspectorCommandResult>) => Promise<T>
): Promise<T> {
  const events: InspectorEvent[] = [];
  let commandId = 1;

  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(options.websocketUrl);
    const pending = new Map<
      number,
      {
        timeout: NodeJS.Timeout;
        resolve: (result: InspectorCommandResult) => void;
        reject: (error: Error) => void;
      }
    >();
    let opened = false;
    let closed = false;

    const close = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      for (const [, entry] of pending) {
        clearTimeout(entry.timeout);
        entry.reject(new Error("Inspector session closed before command completed"));
      }
      pending.clear();
      closeWebSocketSafely(socket);
    };

    const send = async (method: string, params?: object): Promise<InspectorCommandResult> => {
      if (!opened || socket.readyState !== WebSocket.OPEN) {
        throw new Error("Inspector session is not open");
      }

      const id = commandId++;
      return await new Promise((commandResolve, commandReject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          commandReject(new Error(`Timed out after ${options.timeoutMs}ms waiting for ${method}`));
        }, options.timeoutMs);

        pending.set(id, {
          timeout,
          resolve: commandResolve,
          reject: commandReject
        });

        socket.send(
          JSON.stringify({
            id,
            method,
            params: params ?? {}
          })
        );
      });
    };

    socket.on("open", () => {
      opened = true;
      callback(send).then(
        (value) => {
          close();
          resolve(value);
        },
        (error) => {
          close();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });

    socket.on("message", (data) => {
      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch (error) {
        close();
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      if (isInspectorEvent(message)) {
        events.push(message);
        return;
      }

      if (isInspectorResponse(message)) {
        const entry = pending.get(message.id);
        if (!entry) {
          return;
        }

        pending.delete(message.id);
        clearTimeout(entry.timeout);
        entry.resolve({
          response: message,
          events: [...events]
        });
      }
    });

    socket.on("error", (error) => {
      close();
      reject(error);
    });

    socket.on("close", () => {
      close();
      reject(new Error("Inspector session closed"));
    });
  });
}

export function isRetriableInspectorError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes("econnreset") ||
    lower.includes("socket hang up") ||
    lower.includes("socket closed") ||
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("session closed") ||
    lower.includes("session is not open") ||
    lower.includes("inspector session is not open") ||
    lower.includes("diagnostic session is not open") ||
    lower.includes("profiling session is not open")
  );
}

function reloadReconnectTimeoutMs(options: { timeoutMs: number; reconnectTimeoutMs?: number }): number {
  return options.reconnectTimeoutMs ?? Math.max(options.timeoutMs, DEFAULT_RELOAD_RECONNECT_TIMEOUT_MS);
}

class ReloadReconnectError extends Error {
  readonly reloadAlreadySent = true;

  constructor(message: string) {
    super(message);
    this.name = "ReloadReconnectError";
  }
}

function isReloadReconnectError(error: unknown): boolean {
  return (
    error instanceof ReloadReconnectError ||
    (!!error && typeof error === "object" && (error as { reloadAlreadySent?: unknown }).reloadAlreadySent === true)
  );
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
