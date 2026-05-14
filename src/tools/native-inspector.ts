import type { InspectorCommandResult } from "../coherent/protocol.js";
import { coherentgtInspectorSession } from "./inspector.js";

type InspectorCallOptions = {
  debuggerUrl: string;
  pageId: number;
  timeoutMs: number;
};

export async function getResourceTree(options: InspectorCallOptions): Promise<unknown> {
  return await coherentgtInspectorSession(options, async (send) => extractResult("Page.getResourceTree", await send("Page.getResourceTree")));
}

export async function getResourceContent(
  options: InspectorCallOptions,
  input: { url: string; frameId?: string | undefined }
): Promise<unknown> {
  return await coherentgtInspectorSession(options, async (send) => {
    const frameId = input.frameId ?? (await getMainFrameId(send));
    return extractResult(
      "Page.getResourceContent",
      await send("Page.getResourceContent", {
        frameId,
        url: input.url
      })
    );
  });
}

export async function searchResource(
  options: InspectorCallOptions,
  input: { url: string; query: string; frameId?: string | undefined; caseSensitive: boolean; isRegex: boolean }
): Promise<unknown> {
  return await coherentgtInspectorSession(options, async (send) => {
    const frameId = input.frameId ?? (await getMainFrameId(send));
    return extractResult(
      "Page.searchInResource",
      await send("Page.searchInResource", {
        frameId,
        url: input.url,
        query: input.query,
        caseSensitive: input.caseSensitive,
        isRegex: input.isRegex
      })
    );
  });
}

export async function getNativeDocument(
  options: InspectorCallOptions,
  input: { depth?: number | undefined; pierce?: boolean | undefined }
): Promise<unknown> {
  const params: Record<string, unknown> = {};
  if (input.depth !== undefined) {
    params.depth = input.depth;
  }
  if (input.pierce !== undefined) {
    params.pierce = input.pierce;
  }

  return await coherentgtInspectorSession(options, async (send) =>
    extractResult("DOM.getDocument", await send("DOM.getDocument", params))
  );
}

export async function getOuterHtml(
  options: InspectorCallOptions,
  input: { selector?: string | undefined; nodeId?: number | undefined }
): Promise<unknown> {
  return await coherentgtInspectorSession(options, async (send) => {
    const nodeId = input.nodeId ?? (await resolveNodeId(send, input.selector));
    return extractResult("DOM.getOuterHTML", await send("DOM.getOuterHTML", { nodeId }));
  });
}

export async function getStylesheets(options: InspectorCallOptions): Promise<unknown> {
  return await coherentgtInspectorSession(options, async (send) => {
    return extractResult("CSS.getAllStyleSheets", await send("CSS.getAllStyleSheets"));
  });
}

export async function getStylesheetText(
  options: InspectorCallOptions,
  input: { styleSheetId: string }
): Promise<unknown> {
  return await coherentgtInspectorSession(options, async (send) => {
    extractResult("CSS.enable", await send("CSS.enable"));
    return extractResult(
      "CSS.getStyleSheetText",
      await send("CSS.getStyleSheetText", {
        styleSheetId: input.styleSheetId
      })
    );
  });
}

export async function getMatchedStyles(
  options: InspectorCallOptions,
  input: { selector: string }
): Promise<unknown> {
  return await coherentgtInspectorSession(options, async (send) => {
    const nodeId = await resolveNodeId(send, input.selector);
    extractResult("CSS.enable", await send("CSS.enable"));
    return extractResult("CSS.getMatchedStylesForNode", await send("CSS.getMatchedStylesForNode", { nodeId }));
  });
}

async function getMainFrameId(send: (method: string, params?: object) => Promise<InspectorCommandResult>): Promise<string> {
  const result = extractResult("Page.getResourceTree", await send("Page.getResourceTree"));
  const frameId = (result as { frameTree?: { frame?: { id?: unknown } } }).frameTree?.frame?.id;
  if (typeof frameId !== "string") {
    throw new Error("Page.getResourceTree did not return a main frame id");
  }

  return frameId;
}

async function resolveNodeId(
  send: (method: string, params?: object) => Promise<InspectorCommandResult>,
  selector: string | undefined
): Promise<number> {
  if (!selector) {
    throw new Error("selector is required when nodeId is not provided");
  }

  const documentResult = extractResult("DOM.getDocument", await send("DOM.getDocument"));
  const rootNodeId = (documentResult as { root?: { nodeId?: unknown } }).root?.nodeId;
  if (typeof rootNodeId !== "number") {
    throw new Error("DOM.getDocument did not return a root node id");
  }

  const queryResult = extractResult(
    "DOM.querySelector",
    await send("DOM.querySelector", {
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

function extractResult(method: string, result: InspectorCommandResult): unknown {
  const commandResult = result as InspectorCommandResult;
  if (commandResult.response?.error) {
    throw new Error(`${method} failed: ${commandResult.response.error.message}`);
  }

  return commandResult.response?.result ?? {};
}
