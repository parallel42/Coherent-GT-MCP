import type { InspectorCommandResult } from "../coherent/protocol.js";
import { coherentgtInspectorCommand } from "./inspector.js";
import { runtimeEvaluateParams } from "./runtime.js";

export type EvaluateRisk = "read-only" | "may-mutate" | "unknown";

export type NormalizedEvaluateResult = {
  value: unknown;
  type: string;
  subtype?: string | undefined;
  description?: string | undefined;
  wasThrown: boolean;
  exception?: { text: string; url?: string | undefined; line?: number | undefined; column?: number | undefined } | undefined;
  stackFrames: unknown[];
  risk?: EvaluateRisk | undefined;
  warnings?: string[] | undefined;
  timing?: { timeoutMs?: number | undefined; elapsedMs?: number | undefined } | undefined;
  likelyCause?: "main-thread-busy" | "inspector-session-closed" | "inspector-error" | undefined;
};

export async function coherentgtEvaluate(options: {
  debuggerUrl: string;
  pageId: number;
  expression: string;
  awaitPromise: boolean;
  returnByValue: boolean;
  timeoutMs: number;
  risk: EvaluateRisk;
}): Promise<NormalizedEvaluateResult> {
  const startedAt = Date.now();
  let normalized: NormalizedEvaluateResult;
  try {
    const result = (await coherentgtInspectorCommand({
      debuggerUrl: options.debuggerUrl,
      pageId: options.pageId,
      method: "Runtime.evaluate",
      params: runtimeEvaluateParams({
        expression: options.expression,
        awaitPromise: options.awaitPromise,
        returnByValue: options.returnByValue
      }),
      timeoutMs: options.timeoutMs
    })) as InspectorCommandResult;
    normalized = normalizeEvaluateResult(result);
    normalized.timing = { timeoutMs: options.timeoutMs, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    normalized = normalizeInspectorError(error, {
      method: "Runtime.evaluate",
      timeoutMs: options.timeoutMs,
      elapsedMs: Date.now() - startedAt
    });
  }

  normalized.risk = options.risk;
  if (options.risk !== "read-only") {
    normalized.warnings = [`Expression risk is ${options.risk}; this tool reports risk but does not block execution.`];
  }
  return normalized;
}

export function normalizeInspectorError(
  error: unknown,
  context: { method: string; timeoutMs?: number | undefined; elapsedMs?: number | undefined }
): NormalizedEvaluateResult {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const isTimeout = lower.includes("timed out") || lower.includes("timeout");
  const sessionClosed = lower.includes("session closed") || lower.includes("session is not open");

  const timing: { timeoutMs?: number | undefined; elapsedMs?: number | undefined } = {};
  if (context.timeoutMs !== undefined) {
    timing.timeoutMs = context.timeoutMs;
  }
  if (context.elapsedMs !== undefined) {
    timing.elapsedMs = context.elapsedMs;
  }

  return {
    wasThrown: true,
    type: isTimeout ? "timeout" : "error",
    value: undefined,
    description: message,
    exception: { text: message },
    stackFrames: [],
    timing,
    likelyCause:
      isTimeout && context.method === "Runtime.evaluate"
        ? "main-thread-busy"
        : sessionClosed
          ? "inspector-session-closed"
          : "inspector-error"
  };
}

export function normalizeEvaluateResult(result: InspectorCommandResult): NormalizedEvaluateResult {
  if (result.response.error) {
    return {
      wasThrown: true,
      type: "error",
      value: undefined,
      description: result.response.error.message,
      exception: { text: result.response.error.message },
      stackFrames: []
    };
  }

  const envelope = readRecord(result.response.result);
  const remoteObject = readRecord(envelope.result);
  const exceptionDetails = readRecord(envelope.exceptionDetails);
  const stackTrace = readRecord(exceptionDetails.stackTrace);
  const callFrames = Array.isArray(stackTrace.callFrames) ? stackTrace.callFrames : [];
  const wasThrown = envelope.wasThrown === true || Object.keys(exceptionDetails).length > 0;
  const description = stringOrUndefined(remoteObject.description);

  const output: NormalizedEvaluateResult = {
    value: remoteObject.value,
    type: typeof remoteObject.type === "string" ? remoteObject.type : "undefined",
    description,
    wasThrown,
    stackFrames: callFrames
  };

  if (typeof remoteObject.subtype === "string") {
    output.subtype = remoteObject.subtype;
  }
  if (wasThrown) {
    output.exception = {
      text: stringOrUndefined(exceptionDetails.text) ?? description ?? "Runtime evaluation threw",
      url: stringOrUndefined(exceptionDetails.url),
      line: numberOrUndefined(exceptionDetails.line),
      column: numberOrUndefined(exceptionDetails.column)
    };
  }

  return output;
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
