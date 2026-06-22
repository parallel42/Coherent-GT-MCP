import { z } from "zod";

export const pageIdSchema = z.number().int().nonnegative();
export const timeoutMsSchema = z.number().int().positive().max(120000).optional();
export const jsonObjectSchema = z.record(z.string(), z.unknown());

export const healthInputSchema = z.object({}).strict();

export const profileCapabilitiesInputSchema = z.object({}).strict();

export const resultReadInputSchema = z
  .object({
    resultId: z.string().min(1),
    offsetBytes: z.number().int().nonnegative().optional().default(0),
    maxBytes: z.number().int().positive().max(262144).optional()
  })
  .strict();

export const resultSearchInputSchema = z
  .object({
    resultId: z.string().min(1),
    query: z.string().min(1),
    caseSensitive: z.boolean().optional().default(false),
    isRegex: z.boolean().optional().default(false),
    maxMatches: z.number().int().positive().max(100).optional().default(20),
    contextChars: z.number().int().nonnegative().max(1000).optional().default(160)
  })
  .strict();

export const releasePageInputSchema = z
  .object({
    pageId: pageIdSchema
  })
  .strict();

export const releaseAllInputSchema = z.object({}).strict();

export const listViewsInputSchema = z
  .object({
    refresh: z.boolean().optional()
  })
  .strict();

export const listPagesInputSchema = z
  .object({
    refresh: z.boolean().optional(),
    titleContains: z.string().min(1).optional(),
    urlContains: z.string().min(1).optional()
  })
  .strict();

export const inspectorCommandInputSchema = z
  .object({
    pageId: pageIdSchema,
    method: z.string().min(1),
    params: jsonObjectSchema.optional(),
    timeoutMs: timeoutMsSchema
  })
  .strict();

export const evalJsInputSchema = z
  .object({
    pageId: pageIdSchema,
    expression: z.string().min(1),
    awaitPromise: z.boolean().optional().default(false),
    returnByValue: z.boolean().optional().default(true),
    timeoutMs: timeoutMsSchema
  })
  .strict();

export const evaluateInputSchema = z
  .object({
    pageId: pageIdSchema,
    expression: z.string().min(1),
    awaitPromise: z.boolean().optional().default(true),
    returnByValue: z.boolean().optional().default(true),
    risk: z.enum(["read-only", "may-mutate", "unknown"]).optional().default("unknown"),
    timeoutMs: timeoutMsSchema
  })
  .strict();

export const consoleSnapshotInputSchema = z
  .object({
    pageId: pageIdSchema,
    levels: z.array(z.string().min(1)).optional().default(["error", "warning"]),
    textContains: z.string().min(1).optional(),
    maxEvents: z.number().int().positive().max(500).optional().default(50)
  })
  .strict();

export const runtimeErrorsInputSchema = z
  .object({
    pageId: pageIdSchema,
    maxEvents: z.number().int().positive().max(500).optional().default(50)
  })
  .strict();

export const pageHealthInputSchema = z
  .object({
    pageId: pageIdSchema,
    sampleMs: z.number().int().nonnegative().max(5000).optional().default(750),
    globalProbes: z.array(z.string().min(1)).optional()
  })
  .strict();

export const engineDiagnosticsInputSchema = z
  .object({
    pageId: pageIdSchema
  })
  .strict();

export const networkSnapshotInputSchema = z
  .object({
    pageId: pageIdSchema,
    maxEvents: z.number().int().positive().max(5000).optional().default(500),
    maxPayloadChars: z.number().int().nonnegative().max(4096).optional().default(240)
  })
  .strict();

export const eventListenersInputSchema = z
  .object({
    pageId: pageIdSchema,
    selector: z.string().min(1).optional().default("document")
  })
  .strict();

export const traceEventsInputSchema = z
  .object({
    pageId: pageIdSchema,
    timeoutMs: z.number().int().nonnegative().max(30000).optional().default(1000),
    sinceSequence: z.number().int().nonnegative().optional(),
    maxEvents: z.number().int().positive().max(1000).optional().default(100),
    eventTypes: z.array(z.string().min(1)).optional()
  })
  .strict();

const diagnosePageFilterSchema = z.union([
  z.string().min(1),
  z
    .object({
      titleContains: z.string().min(1).optional(),
      urlContains: z.string().min(1).optional()
    })
    .strict()
]);

export const diagnosePageInputSchema = z
  .object({
    pageId: pageIdSchema.optional(),
    pageFilter: diagnosePageFilterSchema.optional(),
    sampleMs: z.number().int().nonnegative().max(5000).optional().default(750),
    consoleLevels: z.array(z.string().min(1)).optional().default(["error", "warning"]),
    globalProbes: z.array(z.string().min(1)).optional(),
    selectors: z.array(z.string().min(1)).max(20).optional(),
    resources: z.array(z.string().min(1)).max(50).optional(),
    images: z.array(z.string().min(1)).max(20).optional()
  })
  .strict();

export const triggerEventInputSchema = z
  .object({
    pageId: pageIdSchema,
    eventName: z.string().min(1),
    args: z.array(z.unknown()).optional().default([])
  })
  .strict();

export const callEngineInputSchema = z
  .object({
    pageId: pageIdSchema,
    functionName: z.string().min(1),
    args: z.array(z.unknown()).optional().default([]),
    awaitPromise: z.boolean().optional().default(true)
  })
  .strict();

export const getDocumentInputSchema = z
  .object({
    pageId: pageIdSchema,
    selector: z.string().min(1).optional().default("document.documentElement"),
    includeText: z.boolean().optional().default(true),
    maxDepth: z.number().int().positive().max(50).optional().default(8)
  })
  .strict();

export const querySelectorInputSchema = z
  .object({
    pageId: pageIdSchema,
    selector: z.string().min(1),
    includeComputedStyle: z.boolean().optional().default(false)
  })
  .strict();

export const setStyleInputSchema = z
  .object({
    pageId: pageIdSchema,
    selector: z.string().min(1),
    styles: z.record(z.string().min(1), z.string())
  })
  .strict();

const actionButtonSchema = z.enum(["left"]).optional().default("left");

export const clickAtInputSchema = z
  .object({
    pageId: pageIdSchema,
    x: z.number().finite(),
    y: z.number().finite(),
    coordinateSpace: z.enum(["viewport"]).optional().default("viewport"),
    button: actionButtonSchema,
    postDelayMs: z.number().int().nonnegative().max(30000).optional().default(100)
  })
  .strict();

export const activateInputSchema = z
  .object({
    pageId: pageIdSchema,
    selector: z.string().min(1).optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    activation: z.enum(["trusted-click", "dom-click", "element-click"]),
    button: actionButtonSchema,
    postconditionExpression: z.string().min(1).optional(),
    timeoutMs: timeoutMsSchema,
    postDelayMs: z.number().int().nonnegative().max(30000).optional().default(100)
  })
  .strict();

export const clickInputSchema = z
  .object({
    pageId: pageIdSchema,
    selector: z.string().min(1)
  })
  .strict();

export const reloadViewInputSchema = z
  .object({
    pageId: pageIdSchema,
    ignoreCache: z.boolean().optional().default(false)
  })
  .strict();

export const navigateViewInputSchema = z
  .object({
    pageId: pageIdSchema,
    url: z.string().url()
  })
  .strict();

export const resourceTreeInputSchema = z
  .object({
    pageId: pageIdSchema
  })
  .strict();

export const resourceContentInputSchema = z
  .object({
    pageId: pageIdSchema,
    url: z.string().min(1),
    frameId: z.string().min(1).optional()
  })
  .strict();

export const resourceSearchInputSchema = z
  .object({
    pageId: pageIdSchema,
    url: z.string().min(1),
    query: z.string().min(1),
    frameId: z.string().min(1).optional(),
    caseSensitive: z.boolean().optional().default(false),
    isRegex: z.boolean().optional().default(false)
  })
  .strict();

export const nativeDocumentInputSchema = z
  .object({
    pageId: pageIdSchema,
    depth: z.number().int().min(-1).max(50).optional(),
    pierce: z.boolean().optional()
  })
  .strict();

export const outerHtmlInputSchema = z
  .object({
    pageId: pageIdSchema,
    selector: z.string().min(1).optional(),
    nodeId: z.number().int().positive().optional()
  })
  .strict();

export const stylesheetsInputSchema = z
  .object({
    pageId: pageIdSchema
  })
  .strict();

export const stylesheetTextInputSchema = z
  .object({
    pageId: pageIdSchema,
    styleSheetId: z.string().min(1)
  })
  .strict();

export const matchedStylesInputSchema = z
  .object({
    pageId: pageIdSchema,
    selector: z.string().min(1)
  })
  .strict();

export const inspectSelectorInputSchema = z
  .object({
    pageId: pageIdSchema,
    selector: z.string().min(1),
    includeComputedStyle: z.boolean().optional().default(true),
    includeMatchedRules: z.boolean().optional().default(false),
    includeOuterHtml: z.boolean().optional().default(true)
  })
  .strict();

export const resourceProbeInputSchema = z
  .object({
    pageId: pageIdSchema,
    url: z.string().min(1),
    includeContent: z.boolean().optional().default(true),
    includeNetwork: z.boolean().optional().default(true),
    frameId: z.string().min(1).optional()
  })
  .strict();

export const imageProbeInputSchema = z
  .object({
    pageId: pageIdSchema,
    url: z.string().min(1),
    timeoutMs: z.number().int().positive().max(30000).optional().default(5000),
    includeResourceProbe: z.boolean().optional().default(true)
  })
  .strict();

export const debugStartInputSchema = z
  .object({
    pageId: pageIdSchema,
    pauseOnExceptions: z.enum(["none", "all", "uncaught"]).optional().default("none")
  })
  .strict();

export const debugStopInputSchema = z
  .object({
    pageId: pageIdSchema
  })
  .strict();

export const debugStatusInputSchema = z
  .object({
    pageId: pageIdSchema.optional()
  })
  .strict();

export const debugEventsInputSchema = z
  .object({
    pageId: pageIdSchema,
    sinceSequence: z.number().int().nonnegative().optional(),
    maxEvents: z.number().int().positive().max(500).optional().default(50),
    eventTypes: z.array(z.string().min(1)).optional()
  })
  .strict();

export const debugListScriptsInputSchema = z
  .object({
    pageId: pageIdSchema,
    urlContains: z.string().min(1).optional()
  })
  .strict();

export const debugGetScriptSourceInputSchema = z
  .object({
    pageId: pageIdSchema,
    scriptId: z.string().min(1)
  })
  .strict();

export const debugSearchScriptInputSchema = z
  .object({
    pageId: pageIdSchema,
    scriptId: z.string().min(1),
    query: z.string().min(1),
    caseSensitive: z.boolean().optional().default(false),
    isRegex: z.boolean().optional().default(false)
  })
  .strict();

export const debugSearchAllScriptsInputSchema = z
  .object({
    pageId: pageIdSchema,
    query: z.string().min(1),
    urlContains: z.string().min(1).optional(),
    caseSensitive: z.boolean().optional().default(false),
    isRegex: z.boolean().optional().default(false),
    maxScripts: z.number().int().positive().max(500).optional().default(100)
  })
  .strict();

export const debugSetBreakpointByUrlInputSchema = z
  .object({
    pageId: pageIdSchema,
    url: z.string().min(1),
    lineNumber: z.number().int().nonnegative(),
    columnNumber: z.number().int().nonnegative().optional().default(0),
    condition: z.string().optional()
  })
  .strict();

export const debugSetBreakpointInputSchema = z
  .object({
    pageId: pageIdSchema,
    scriptId: z.string().min(1),
    lineNumber: z.number().int().nonnegative(),
    columnNumber: z.number().int().nonnegative().optional().default(0),
    condition: z.string().optional()
  })
  .strict();

export const debugRemoveBreakpointInputSchema = z
  .object({
    pageId: pageIdSchema,
    breakpointId: z.string().min(1)
  })
  .strict();

export const debugPageInputSchema = z
  .object({
    pageId: pageIdSchema
  })
  .strict();

export const debugCommandInputSchema = z
  .object({
    pageId: pageIdSchema,
    method: z.string().min(1),
    params: jsonObjectSchema.optional()
  })
  .strict();

export const debugEvaluateInputSchema = z
  .object({
    pageId: pageIdSchema,
    callFrameId: z.string().min(1).optional(),
    expression: z.string().min(1),
    returnByValue: z.boolean().optional().default(true)
  })
  .strict();

export const debugEventBreakpointInputSchema = z
  .object({
    pageId: pageIdSchema,
    eventName: z.string().min(1)
  })
  .strict();

export const debugXhrBreakpointInputSchema = z
  .object({
    pageId: pageIdSchema,
    url: z.string().optional().default("")
  })
  .strict();

export const debugDomBreakpointInputSchema = z
  .object({
    pageId: pageIdSchema,
    selector: z.string().min(1),
    type: z.enum(["subtree-modified", "attribute-modified", "node-removed"])
  })
  .strict();

export const profileInstrumentSchema = z.enum(["timeline", "script", "network", "heap", "layerTree"]);
export const timelineInstrumentSchema = z.enum(["Timeline", "ScriptProfiler", "Memory", "Heap"]);

export const profileStartInputSchema = z
  .object({
    pageId: pageIdSchema,
    instruments: z.array(profileInstrumentSchema).min(1).optional().default(["timeline", "script", "network"]),
    reload: z.boolean().optional().default(false),
    ignoreCache: z.boolean().optional().default(false),
    maxCallStackDepth: z.number().int().positive().max(1024).optional().default(128),
    timelineInstruments: z.array(timelineInstrumentSchema).min(1).optional()
  })
  .strict();

export const captureAllStartInputSchema = z
  .object({
    pageId: pageIdSchema,
    reload: z.boolean().optional().default(false),
    ignoreCache: z.boolean().optional().default(false),
    maxCallStackDepth: z.number().int().positive().max(1024).optional().default(128),
    timelineInstruments: z.array(timelineInstrumentSchema).min(1).optional()
  })
  .strict();

export const profileStopInputSchema = z
  .object({
    pageId: pageIdSchema,
    instruments: z.array(profileInstrumentSchema).min(1).optional()
  })
  .strict();

export const profileStatusInputSchema = z
  .object({
    pageId: pageIdSchema.optional()
  })
  .strict();

export const profileEventsInputSchema = z
  .object({
    pageId: pageIdSchema,
    sinceSequence: z.number().int().nonnegative().optional(),
    maxEvents: z.number().int().positive().max(1000).optional().default(100),
    eventTypes: z.array(z.string().min(1)).optional(),
    includeParams: z.boolean().optional().default(false)
  })
  .strict();

export const profileRawInputSchema = z
  .object({
    pageId: pageIdSchema,
    rawId: z.string().min(1)
  })
  .strict();

export const focusedProfileStartInputSchema = z
  .object({
    pageId: pageIdSchema,
    reload: z.boolean().optional().default(false),
    ignoreCache: z.boolean().optional().default(false),
    maxCallStackDepth: z.number().int().positive().max(1024).optional().default(128)
  })
  .strict();

export const timelineStartInputSchema = z
  .object({
    pageId: pageIdSchema,
    reload: z.boolean().optional().default(false),
    ignoreCache: z.boolean().optional().default(false),
    maxCallStackDepth: z.number().int().positive().max(1024).optional().default(128),
    timelineInstruments: z.array(timelineInstrumentSchema).min(1).optional()
  })
  .strict();

export const profilePageInputSchema = z
  .object({
    pageId: pageIdSchema
  })
  .strict();

export const layerTreeInputSchema = z
  .object({
    pageId: pageIdSchema,
    nodeId: z.number().int().positive().optional(),
    selector: z.string().min(1).optional()
  })
  .strict();

export const compositingReasonsInputSchema = z
  .object({
    pageId: pageIdSchema,
    layerId: z.string().min(1)
  })
  .strict();

export const visualOverlayInputSchema = z
  .object({
    pageId: pageIdSchema,
    visible: z.boolean()
  })
  .strict();
