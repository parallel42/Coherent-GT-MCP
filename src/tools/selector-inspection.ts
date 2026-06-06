import type { InspectorCommandResult } from "../coherent/protocol.js";
import { coherentgtInspectorSession } from "./inspector.js";

type InspectorCallOptions = {
  debuggerUrl: string;
  pageId: number;
  timeoutMs: number;
};

type OptionalCommandResult = {
  method: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

type StyleEntry = {
  name?: unknown;
  value?: unknown;
};

export async function inspectSelector(
  options: InspectorCallOptions,
  input: { selector: string; includeComputedStyle: boolean; includeMatchedRules: boolean; includeOuterHtml: boolean }
): Promise<unknown> {
  return await coherentgtInspectorSession(options, async (send) => {
    const root = readRecord(extractResult("DOM.getDocument", await send("DOM.getDocument")));
    const rootNodeId = readRecord(root.root).nodeId;
    if (typeof rootNodeId !== "number") {
      throw new Error("DOM.getDocument did not return a root node id");
    }

    const query = readRecord(
      extractResult("DOM.querySelector", await send("DOM.querySelector", { nodeId: rootNodeId, selector: input.selector }))
    );
    const nodeId = query.nodeId;
    if (typeof nodeId !== "number" || nodeId <= 0) {
      return { selector: input.selector, found: false };
    }

    const boxModel = await optionalCommand(send, "DOM.getBoxModel", { nodeId });
    const computedStyle = input.includeComputedStyle
      ? await optionalCommand(send, "CSS.getComputedStyleForNode", { nodeId }, "CSS.enable")
      : undefined;
    const matchedRules = input.includeMatchedRules
      ? await optionalCommand(send, "CSS.getMatchedStylesForNode", { nodeId }, "CSS.enable")
      : undefined;
    const outerHTML = input.includeOuterHtml ? await optionalCommand(send, "DOM.getOuterHTML", { nodeId }) : undefined;

    return summarizeSelectorInspection({
      selector: input.selector,
      nodeId,
      boxModel: boxModel.ok ? boxModel.result : undefined,
      computedStyle: computedStyle?.ok ? readRecord(computedStyle.result).computedStyle : undefined,
      matchedRules: matchedRules?.ok ? matchedRules.result : undefined,
      outerHTML: outerHTML?.ok ? readRecord(outerHTML.result).outerHTML : undefined,
      errors: [boxModel, computedStyle, matchedRules, outerHTML].filter(
        (entry): entry is OptionalCommandResult => !!entry && !entry.ok
      )
    });
  });
}

export function summarizeSelectorInspection(input: {
  selector: string;
  nodeId?: number | undefined;
  boxModel?: unknown;
  computedStyle?: unknown;
  matchedRules?: unknown;
  outerHTML?: unknown;
  errors?: OptionalCommandResult[] | undefined;
}): Record<string, unknown> {
  const computed = styleMap(input.computedStyle);
  const boundingBox = boundingBoxFromModel(input.boxModel);
  const display = computed.display;
  const visibility = computed.visibility;
  const opacity = opacityNumber(computed.opacity);
  const hasBox = !!boundingBox && boundingBox.width > 0 && boundingBox.height > 0;
  const visible = display !== "none" && visibility !== "hidden" && visibility !== "collapse" && opacity !== 0 && hasBox;

  return compactUndefined({
    selector: input.selector,
    found: typeof input.nodeId === "number",
    nodeId: input.nodeId,
    outerHTML: typeof input.outerHTML === "string" ? input.outerHTML : undefined,
    boundingBox,
    visibility: {
      display,
      visibility,
      opacity,
      hasBox,
      visible
    },
    computedStyle: Object.keys(computed).length > 0 ? computed : undefined,
    matchedRules: input.matchedRules,
    errors: input.errors && input.errors.length > 0 ? input.errors : undefined
  });
}

async function optionalCommand(
  send: (method: string, params?: object) => Promise<InspectorCommandResult>,
  method: string,
  params?: object | undefined,
  enableMethod?: string | undefined
): Promise<OptionalCommandResult> {
  try {
    if (enableMethod) {
      const enable = await send(enableMethod);
      if (enable.response.error) {
        return { method, ok: false, error: `${enableMethod} failed: ${enable.response.error.message}` };
      }
    }
    return { method, ok: true, result: extractResult(method, await send(method, params)) };
  } catch (error) {
    return { method, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function extractResult(method: string, result: InspectorCommandResult): unknown {
  if (result.response.error) {
    throw new Error(`${method} failed: ${result.response.error.message}`);
  }
  return result.response.result ?? {};
}

function styleMap(value: unknown): Record<string, string> {
  const styles = Array.isArray(value) ? value : [];
  const output: Record<string, string> = {};
  for (const style of styles) {
    const entry = style as StyleEntry;
    if (typeof entry.name === "string" && typeof entry.value === "string") {
      output[entry.name] = entry.value;
    }
  }
  return output;
}

function boundingBoxFromModel(value: unknown): { x: number; y: number; width: number; height: number } | undefined {
  const model = readRecord(readRecord(value).model);
  const width = numberOrUndefined(model.width);
  const height = numberOrUndefined(model.height);
  const content = Array.isArray(model.content) ? model.content.map(numberOrUndefined) : [];
  if (width === undefined || height === undefined || content.length < 2) {
    return undefined;
  }
  const x = content[0];
  const y = content[1];
  if (x === undefined || y === undefined) {
    return undefined;
  }
  return { x, y, width, height };
}

function opacityNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
