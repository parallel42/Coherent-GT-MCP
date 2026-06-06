import type { InspectorCommandResult } from "../coherent/protocol.js";
import { coherentgtEvaluate, type NormalizedEvaluateResult } from "./evaluate.js";
import { queryHostResourceResolution, type HostCorrelationOptions } from "./host-helper.js";
import { coherentgtInspectorSession } from "./inspector.js";

type InspectorCallOptions = {
  debuggerUrl: string;
  pageId: number;
  timeoutMs: number;
  hostCorrelation?: HostCorrelationOptions | undefined;
};

export async function probeResource(
  options: InspectorCallOptions,
  input: {
    url: string;
    includeContent: boolean;
    includeNetwork: boolean;
    frameId?: string | undefined;
    network?: Record<string, unknown> | undefined;
  }
): Promise<Record<string, unknown>> {
  const native = await coherentgtInspectorSession(options, async (send) => {
    const resourceTree = extractResult("Page.getResourceTree", await send("Page.getResourceTree"));
    const resources = collectResources(readRecord(resourceTree).frameTree);
    const resource = resources.find((entry) => entry.url === input.url);
    const frameId = input.frameId ?? mainFrameId(resourceTree);
    const content =
      input.includeContent && frameId
        ? await optionalResourceContent(send, {
            frameId,
            url: input.url
          })
        : undefined;

    return {
      resource,
      content: content?.ok ? content.result : undefined,
      errors: content && !content.ok ? [content] : []
    };
  });

  const hostResolution = options.hostCorrelation
    ? await queryHostResourceResolution(options.hostCorrelation, input.url)
    : undefined;

  return summarizeResourceProbe({
    url: input.url,
    resource: native.resource,
    content: native.content,
    network: input.includeNetwork ? input.network : undefined,
    hostResolution,
    errors: native.errors
  });
}

export async function probeImage(
  options: InspectorCallOptions,
  input: {
    url: string;
    timeoutMs: number;
    includeResourceProbe: boolean;
    network?: Record<string, unknown> | undefined;
  }
): Promise<Record<string, unknown>> {
  const runtimeDecode = await coherentgtEvaluate({
    debuggerUrl: options.debuggerUrl,
    pageId: options.pageId,
    expression: buildImageProbeExpression(input.url, input.timeoutMs),
    awaitPromise: true,
    returnByValue: true,
    timeoutMs: input.timeoutMs + 1000,
    risk: "read-only"
  });
  const resource = input.includeResourceProbe
    ? await probeResource(options, {
        url: input.url,
        includeContent: true,
        includeNetwork: true,
        network: input.network
      })
    : undefined;

  return compactUndefined({
    url: input.url,
    runtimeDecode,
    resource,
    verdict: imageProbeVerdict(runtimeDecode, resource)
  });
}

export function summarizeResourceProbe(input: {
  url: string;
  resource?: Record<string, unknown> | undefined;
  content?: { content?: string | undefined; base64Encoded?: boolean | undefined } | undefined;
  network?: Record<string, unknown> | undefined;
  hostResolution?: unknown;
  errors?: unknown[] | undefined;
}): Record<string, unknown> {
  const base64Encoded = input.content?.base64Encoded === true;
  const content = input.content?.content ?? "";
  const byteLength = input.content
    ? base64Encoded
      ? Buffer.byteLength(content, "base64")
      : Buffer.byteLength(content, "utf8")
    : undefined;
  const warnings: string[] = [];
  if (!input.resource) {
    warnings.push("Resource was not found in Page.getResourceTree.");
  }
  if (input.content && byteLength === 0) {
    warnings.push("Resource content was empty.");
  }
  if (readRecord(input.network).failed === true) {
    warnings.push("Network events reported a failed request for this URL.");
  }

  return compactUndefined({
    url: input.url,
    foundInResourceTree: !!input.resource,
    type: input.resource?.type,
    mimeType: input.resource?.mimeType,
    byteLength,
    base64Encoded: input.content ? base64Encoded : undefined,
    network: input.network,
    hostResolution: input.hostResolution,
    errors: input.errors && input.errors.length > 0 ? input.errors : undefined,
    warnings
  });
}

export function buildImageProbeExpression(url: string, timeoutMs: number): string {
  return `(function() {
  var done = false;
  var img = new Image();
  var startedAt = Date.now();
  var timeoutMs = ${Math.max(1, Math.min(timeoutMs, 30000))};
  return new Promise(function(resolve) {
    function finish(result) {
      if (done) return;
      done = true;
      result.elapsedMs = Date.now() - startedAt;
      resolve(result);
    }
    img.onload = function() {
      finish({
        loaded: true,
        error: null,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        complete: img.complete
      });
    };
    img.onerror = function() {
      finish({
        loaded: false,
        error: "image load failed",
        naturalWidth: img.naturalWidth || 0,
        naturalHeight: img.naturalHeight || 0,
        complete: img.complete
      });
    };
    setTimeout(function() {
      finish({
        loaded: false,
        error: "timeout",
        naturalWidth: img.naturalWidth || 0,
        naturalHeight: img.naturalHeight || 0,
        complete: img.complete
      });
    }, timeoutMs);
    img.src = ${JSON.stringify(url)};
  });
})()`;
}

export function imageProbeVerdict(runtimeDecode: Partial<NormalizedEvaluateResult>, resource?: unknown): string {
  if (runtimeDecode.likelyCause === "main-thread-busy") {
    return "main-thread-busy";
  }
  const value = readRecord(runtimeDecode.value);
  if (value.loaded === true && numberValue(value.naturalWidth) > 0 && numberValue(value.naturalHeight) > 0) {
    return "decoded";
  }
  const resourceRecord = readRecord(resource);
  const network = readRecord(resourceRecord.network);
  if (network.failed === true || typeof network.errorText === "string") {
    return "request-failed";
  }
  if (value.loaded === false || typeof value.error === "string") {
    return "decode-failed";
  }
  return "unknown";
}

async function optionalResourceContent(
  send: (method: string, params?: object) => Promise<InspectorCommandResult>,
  params: { frameId: string; url: string }
): Promise<{ ok: boolean; result?: { content?: string; base64Encoded?: boolean }; error?: string }> {
  try {
    const result = extractResult("Page.getResourceContent", await send("Page.getResourceContent", params));
    const record = readRecord(result);
    return {
      ok: true,
      result: {
        content: typeof record.content === "string" ? record.content : "",
        base64Encoded: record.base64Encoded === true
      }
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function mainFrameId(resourceTree: unknown): string | undefined {
  const id = readRecord(readRecord(readRecord(resourceTree).frameTree).frame).id;
  return typeof id === "string" ? id : undefined;
}

function collectResources(frameTree: unknown): Array<Record<string, unknown>> {
  const tree = readRecord(frameTree);
  const resources = Array.isArray(tree.resources) ? tree.resources.map(readRecord) : [];
  const childFrames = Array.isArray(tree.childFrames) ? tree.childFrames : [];
  for (const child of childFrames) {
    resources.push(...collectResources(child));
  }
  return resources;
}

function extractResult(method: string, result: InspectorCommandResult): unknown {
  if (result.response.error) {
    throw new Error(`${method} failed: ${result.response.error.message}`);
  }
  return result.response.result ?? {};
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
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
