import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { CoherentDebuggerClient } from "./coherent/debugger-client.js";
import type { AppConfig } from "./config.js";
import { coherentgtProfileCapabilities } from "./tools/capabilities.js";
import { coherentgtHealth } from "./tools/health.js";
import { coherentgtInspectorCommand } from "./tools/inspector.js";
import { buildLocationReloadExpression, pageNavigateParams, pageReloadParams } from "./tools/navigation.js";
import {
  getMatchedStyles,
  getNativeDocument,
  getOuterHtml,
  getResourceContent,
  getResourceTree,
  getStylesheetText,
  getStylesheets,
  searchResource
} from "./tools/native-inspector.js";
import { coherentgtListViews } from "./tools/views.js";
import {
  captureAllStartInputSchema,
  callEngineInputSchema,
  clickInputSchema,
  compositingReasonsInputSchema,
  debugDomBreakpointInputSchema,
  debugCommandInputSchema,
  debugEvaluateInputSchema,
  debugEventBreakpointInputSchema,
  debugEventsInputSchema,
  debugGetScriptSourceInputSchema,
  debugListScriptsInputSchema,
  debugPageInputSchema,
  debugRemoveBreakpointInputSchema,
  debugSearchAllScriptsInputSchema,
  debugSearchScriptInputSchema,
  debugSetBreakpointByUrlInputSchema,
  debugSetBreakpointInputSchema,
  debugStartInputSchema,
  debugStatusInputSchema,
  debugStopInputSchema,
  debugXhrBreakpointInputSchema,
  evalJsInputSchema,
  getDocumentInputSchema,
  healthInputSchema,
  inspectorCommandInputSchema,
  focusedProfileStartInputSchema,
  layerTreeInputSchema,
  listViewsInputSchema,
  matchedStylesInputSchema,
  nativeDocumentInputSchema,
  navigateViewInputSchema,
  outerHtmlInputSchema,
  profileEventsInputSchema,
  profileCapabilitiesInputSchema,
  profilePageInputSchema,
  profileRawInputSchema,
  profileStartInputSchema,
  profileStatusInputSchema,
  profileStopInputSchema,
  querySelectorInputSchema,
  reloadViewInputSchema,
  resourceContentInputSchema,
  resourceSearchInputSchema,
  resourceTreeInputSchema,
  setStyleInputSchema,
  stylesheetTextInputSchema,
  stylesheetsInputSchema,
  timelineStartInputSchema,
  triggerEventInputSchema,
  visualOverlayInputSchema
} from "./tools/schemas.js";
import { buildSetStyleExpression } from "./tools/css.js";
import { DebugSessionManager } from "./tools/debugger.js";
import { buildGetDocumentExpression, buildQuerySelectorExpression } from "./tools/dom.js";
import { buildClickExpression } from "./tools/events.js";
import { jsonToolResult } from "./tools/result.js";
import { ProfilingSessionManager } from "./tools/profiling.js";
import { buildEngineCallExpression, buildEngineTriggerExpression, runtimeEvaluateParams } from "./tools/runtime.js";

export type McpSharedState = {
  debuggerClient: CoherentDebuggerClient;
  debugSessions: DebugSessionManager;
  profilingSessions: ProfilingSessionManager;
};

export type CreateMcpServerOptions = {
  state?: McpSharedState;
  enableIdleShutdown?: boolean;
  onIdle?: () => Promise<void>;
  onActivity?: () => void;
};

export function createMcpSharedState(config: AppConfig): McpSharedState {
  return {
    debuggerClient: new CoherentDebuggerClient(config.debuggerUrl, config.requestTimeoutMs),
    debugSessions: new DebugSessionManager({
      debuggerUrl: config.debuggerUrl,
      timeoutMs: config.wsTimeoutMs
    }),
    profilingSessions: new ProfilingSessionManager({
      debuggerUrl: config.debuggerUrl,
      timeoutMs: config.wsTimeoutMs
    })
  };
}

export function createMcpServer(config: AppConfig, options: CreateMcpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: "coherent-gt-mcp",
    version: "0.1.0"
  });

  const { debuggerClient, debugSessions, profilingSessions } = options.state ?? createMcpSharedState(config);
  const idleShutdown = createIdleShutdown(config.idleTimeoutMs, async () => {
    await options.onIdle?.();
  }, options.enableIdleShutdown ?? true);

  const run = async (fn: () => Promise<unknown> | unknown): Promise<CallToolResult> => {
    idleShutdown.reset();
    options.onActivity?.();
    try {
      return jsonToolResult(await fn(), config.maxTextBytes);
    } catch (error) {
      return {
        isError: true,
        ...jsonToolResult(
          {
            error: error instanceof Error ? error.message : String(error)
          },
          config.maxTextBytes
        )
      };
    } finally {
      idleShutdown.reset();
    }
  };

  server.registerTool(
    "coherentgt_health",
    {
      title: "Coherent GT Health",
      description: "Check Coherent debugger root and /pagelist.json.",
      inputSchema: healthInputSchema
    },
    async () => run(() => coherentgtHealth(debuggerClient))
  );

  server.registerTool(
    "coherentgt_list_views",
    {
      title: "List Coherent GT Views",
      description: "List live Coherent GT debugger views with inspector WebSocket URLs.",
      inputSchema: listViewsInputSchema
    },
    async () => run(() => coherentgtListViews(debuggerClient))
  );

  server.registerTool(
    "coherentgt_profile_capabilities",
    {
      title: "Profiling Capabilities",
      description:
        "Explain Coherent GT legacy WebKit profiling support, Chrome-only domain limitations, and the recommended capture workflow for agents.",
      inputSchema: profileCapabilitiesInputSchema
    },
    async () => run(() => coherentgtProfileCapabilities())
  );

  server.registerTool(
    "coherentgt_inspector_command",
    {
      title: "Inspector Command",
      description: "Send a raw WebKit Inspector command to a Coherent GT view.",
      inputSchema: inspectorCommandInputSchema
    },
    async (args: z.infer<typeof inspectorCommandInputSchema>) =>
      run(() =>
        coherentgtInspectorCommand({
          debuggerUrl: config.debuggerUrl,
          pageId: args.pageId,
          method: args.method,
          params: args.params,
          timeoutMs: args.timeoutMs ?? config.wsTimeoutMs
        })
      )
  );

  server.registerTool(
    "coherentgt_eval_js",
    {
      title: "Evaluate JavaScript",
      description: "Evaluate JavaScript in a live Coherent GT view.",
      inputSchema: evalJsInputSchema
    },
    async (args: z.infer<typeof evalJsInputSchema>) =>
      run(() =>
        coherentgtInspectorCommand({
          debuggerUrl: config.debuggerUrl,
          pageId: args.pageId,
          method: "Runtime.evaluate",
          params: runtimeEvaluateParams(args),
          timeoutMs: args.timeoutMs ?? config.wsTimeoutMs
        })
      )
  );

  server.registerTool(
    "coherentgt_trigger_event",
    {
      title: "Trigger Engine Event",
      description: "Mutating: calls engine.trigger(...) in a live Coherent GT view.",
      inputSchema: triggerEventInputSchema,
      annotations: {
        destructiveHint: true,
        readOnlyHint: false
      }
    },
    async (args: z.infer<typeof triggerEventInputSchema>) =>
      run(() =>
        coherentgtInspectorCommand({
          debuggerUrl: config.debuggerUrl,
          pageId: args.pageId,
          method: "Runtime.evaluate",
          params: runtimeEvaluateParams({
            expression: buildEngineTriggerExpression(args.eventName, args.args),
            awaitPromise: false,
            returnByValue: true
          }),
          timeoutMs: config.wsTimeoutMs
        })
      )
  );

  server.registerTool(
    "coherentgt_call_engine",
    {
      title: "Call Engine Function",
      description: "Mutating: calls engine.call(...) in a live Coherent GT view.",
      inputSchema: callEngineInputSchema,
      annotations: {
        destructiveHint: true,
        readOnlyHint: false
      }
    },
    async (args: z.infer<typeof callEngineInputSchema>) =>
      run(() =>
        coherentgtInspectorCommand({
          debuggerUrl: config.debuggerUrl,
          pageId: args.pageId,
          method: "Runtime.evaluate",
          params: runtimeEvaluateParams({
            expression: buildEngineCallExpression(args.functionName, args.args),
            awaitPromise: args.awaitPromise,
            returnByValue: true
          }),
          timeoutMs: config.wsTimeoutMs
        })
      )
  );

  server.registerTool(
    "coherentgt_get_document",
    {
      title: "Get Document",
      description: "Serialize a DOM subtree from a live Coherent GT view.",
      inputSchema: getDocumentInputSchema
    },
    async (args: z.infer<typeof getDocumentInputSchema>) =>
      run(() =>
        coherentgtInspectorCommand({
          debuggerUrl: config.debuggerUrl,
          pageId: args.pageId,
          method: "Runtime.evaluate",
          params: runtimeEvaluateParams({
            expression: buildGetDocumentExpression(args),
            returnByValue: true
          }),
          timeoutMs: config.wsTimeoutMs
        })
      )
  );

  server.registerTool(
    "coherentgt_query_selector",
    {
      title: "Query Selector",
      description: "Query DOM nodes in a live Coherent GT view.",
      inputSchema: querySelectorInputSchema
    },
    async (args: z.infer<typeof querySelectorInputSchema>) =>
      run(() =>
        coherentgtInspectorCommand({
          debuggerUrl: config.debuggerUrl,
          pageId: args.pageId,
          method: "Runtime.evaluate",
          params: runtimeEvaluateParams({
            expression: buildQuerySelectorExpression(args),
            returnByValue: true
          }),
          timeoutMs: config.wsTimeoutMs
        })
      )
  );

  server.registerTool(
    "coherentgt_set_style",
    {
      title: "Set Style",
      description: "Mutating: apply inline styles to matched DOM nodes in a live Coherent GT view.",
      inputSchema: setStyleInputSchema,
      annotations: {
        destructiveHint: true,
        readOnlyHint: false
      }
    },
    async (args: z.infer<typeof setStyleInputSchema>) =>
      run(() =>
        coherentgtInspectorCommand({
          debuggerUrl: config.debuggerUrl,
          pageId: args.pageId,
          method: "Runtime.evaluate",
          params: runtimeEvaluateParams({
            expression: buildSetStyleExpression(args),
            returnByValue: true
          }),
          timeoutMs: config.wsTimeoutMs
        })
      )
  );

  server.registerTool(
    "coherentgt_click",
    {
      title: "Click Element",
      description: "Mutating: dispatch mouse events on the first matched element in a live Coherent GT view.",
      inputSchema: clickInputSchema,
      annotations: {
        destructiveHint: true,
        readOnlyHint: false
      }
    },
    async (args: z.infer<typeof clickInputSchema>) =>
      run(() =>
        coherentgtInspectorCommand({
          debuggerUrl: config.debuggerUrl,
          pageId: args.pageId,
          method: "Runtime.evaluate",
          params: runtimeEvaluateParams({
            expression: buildClickExpression(args.selector),
            returnByValue: true
          }),
          timeoutMs: config.wsTimeoutMs
        })
      )
  );

  server.registerTool(
    "coherentgt_reload_view",
    {
      title: "Reload View",
      description: "Mutating: reload a live Coherent GT view.",
      inputSchema: reloadViewInputSchema,
      annotations: {
        destructiveHint: true,
        readOnlyHint: false
      }
    },
    async (args: z.infer<typeof reloadViewInputSchema>) =>
      run(async () => {
        const reloadResult = await coherentgtInspectorCommand({
          debuggerUrl: config.debuggerUrl,
          pageId: args.pageId,
          method: "Page.reload",
          params: pageReloadParams(args.ignoreCache),
          timeoutMs: config.wsTimeoutMs
        });

        if (hasInspectorError(reloadResult)) {
          return await coherentgtInspectorCommand({
            debuggerUrl: config.debuggerUrl,
            pageId: args.pageId,
            method: "Runtime.evaluate",
            params: runtimeEvaluateParams({
              expression: buildLocationReloadExpression(),
              returnByValue: true
            }),
            timeoutMs: config.wsTimeoutMs
          });
        }

        return reloadResult;
      })
  );

  server.registerTool(
    "coherentgt_navigate_view",
    {
      title: "Navigate View",
      description: "High-risk mutating: navigate a live Coherent GT view to a new URL.",
      inputSchema: navigateViewInputSchema,
      annotations: {
        destructiveHint: true,
        readOnlyHint: false
      }
    },
    async (args: z.infer<typeof navigateViewInputSchema>) =>
      run(() =>
        coherentgtInspectorCommand({
          debuggerUrl: config.debuggerUrl,
          pageId: args.pageId,
          method: "Page.navigate",
          params: pageNavigateParams(args.url),
          timeoutMs: config.wsTimeoutMs
        })
      )
  );

  server.registerTool(
    "coherentgt_get_resource_tree",
    {
      title: "Get Resource Tree",
      description: "Read the native WebInspector Page.getResourceTree for a live Coherent GT view.",
      inputSchema: resourceTreeInputSchema
    },
    async (args: z.infer<typeof resourceTreeInputSchema>) =>
      run(() =>
        getResourceTree({
          debuggerUrl: config.debuggerUrl,
          pageId: args.pageId,
          timeoutMs: config.wsTimeoutMs
        })
      )
  );

  server.registerTool(
    "coherentgt_get_resource_content",
    {
      title: "Get Resource Content",
      description: "Read loaded resource text via native WebInspector Page.getResourceContent.",
      inputSchema: resourceContentInputSchema
    },
    async (args: z.infer<typeof resourceContentInputSchema>) =>
      run(() =>
        getResourceContent(
          {
            debuggerUrl: config.debuggerUrl,
            pageId: args.pageId,
            timeoutMs: config.wsTimeoutMs
          },
          args
        )
      )
  );

  server.registerTool(
    "coherentgt_search_resource",
    {
      title: "Search Resource",
      description: "Search a loaded resource via native WebInspector Page.searchInResource.",
      inputSchema: resourceSearchInputSchema
    },
    async (args: z.infer<typeof resourceSearchInputSchema>) =>
      run(() =>
        searchResource(
          {
            debuggerUrl: config.debuggerUrl,
            pageId: args.pageId,
            timeoutMs: config.wsTimeoutMs
          },
          args
        )
      )
  );

  server.registerTool(
    "coherentgt_get_native_document",
    {
      title: "Get Native DOM Document",
      description: "Read the native WebInspector DOM.getDocument tree for a live Coherent GT view.",
      inputSchema: nativeDocumentInputSchema
    },
    async (args: z.infer<typeof nativeDocumentInputSchema>) =>
      run(() =>
        getNativeDocument(
          {
            debuggerUrl: config.debuggerUrl,
            pageId: args.pageId,
            timeoutMs: config.wsTimeoutMs
          },
          args
        )
      )
  );

  server.registerTool(
    "coherentgt_get_outer_html",
    {
      title: "Get Outer HTML",
      description: "Read native DOM outerHTML for a node id or selector in a live Coherent GT view.",
      inputSchema: outerHtmlInputSchema
    },
    async (args: z.infer<typeof outerHtmlInputSchema>) =>
      run(() =>
        getOuterHtml(
          {
            debuggerUrl: config.debuggerUrl,
            pageId: args.pageId,
            timeoutMs: config.wsTimeoutMs
          },
          args
        )
      )
  );

  server.registerTool(
    "coherentgt_get_stylesheets",
    {
      title: "Get Stylesheets",
      description: "List native WebInspector CSS stylesheet headers for a live Coherent GT view.",
      inputSchema: stylesheetsInputSchema
    },
    async (args: z.infer<typeof stylesheetsInputSchema>) =>
      run(() =>
        getStylesheets({
          debuggerUrl: config.debuggerUrl,
          pageId: args.pageId,
          timeoutMs: config.wsTimeoutMs
        })
      )
  );

  server.registerTool(
    "coherentgt_get_stylesheet_text",
    {
      title: "Get Stylesheet Text",
      description: "Read CSS text for a WebInspector styleSheetId.",
      inputSchema: stylesheetTextInputSchema
    },
    async (args: z.infer<typeof stylesheetTextInputSchema>) =>
      run(() =>
        getStylesheetText(
          {
            debuggerUrl: config.debuggerUrl,
            pageId: args.pageId,
            timeoutMs: config.wsTimeoutMs
          },
          args
        )
      )
  );

  server.registerTool(
    "coherentgt_get_matched_styles",
    {
      title: "Get Matched Styles",
      description: "Read native WebInspector matched CSS rules for a selector in a live Coherent GT view.",
      inputSchema: matchedStylesInputSchema
    },
    async (args: z.infer<typeof matchedStylesInputSchema>) =>
      run(() =>
        getMatchedStyles(
          {
            debuggerUrl: config.debuggerUrl,
            pageId: args.pageId,
            timeoutMs: config.wsTimeoutMs
          },
          args
        )
      )
  );

  server.registerTool(
    "coherentgt_profile_start",
    {
      title: "Start Profiling",
      description: "Start a persistent legacy WebInspector profiling capture for selected instruments.",
      inputSchema: profileStartInputSchema,
      annotations: { readOnlyHint: false }
    },
    async (args: z.infer<typeof profileStartInputSchema>) =>
      run(() =>
        profilingSessions.start(args.pageId, {
          instruments: args.instruments,
          reload: args.reload,
          ignoreCache: args.ignoreCache,
          maxCallStackDepth: args.maxCallStackDepth,
          timelineInstruments: args.timelineInstruments
        })
      )
  );

  server.registerTool(
    "coherentgt_profile_stop",
    {
      title: "Stop Profiling",
      description: "Stop active profiling instruments and return compact capture summaries.",
      inputSchema: profileStopInputSchema,
      annotations: { readOnlyHint: false }
    },
    async (args: z.infer<typeof profileStopInputSchema>) => run(() => profilingSessions.stop(args.pageId, args.instruments))
  );

  server.registerTool(
    "coherentgt_profile_status",
    {
      title: "Profiling Status",
      description: "Show one profiling session status or all active profiling sessions.",
      inputSchema: profileStatusInputSchema
    },
    async (args: z.infer<typeof profileStatusInputSchema>) => run(() => profilingSessions.status(args.pageId))
  );

  server.registerTool(
    "coherentgt_profile_events",
    {
      title: "Profiling Events",
      description: "Read buffered profiling events. Params are omitted by default; use includeParams for raw event payloads.",
      inputSchema: profileEventsInputSchema
    },
    async (args: z.infer<typeof profileEventsInputSchema>) => run(() => profilingSessions.events(args.pageId, args))
  );

  server.registerTool(
    "coherentgt_profile_raw",
    {
      title: "Profiling Raw Payload",
      description: "Read a retained raw profiling payload by rawId.",
      inputSchema: profileRawInputSchema
    },
    async (args: z.infer<typeof profileRawInputSchema>) => run(() => profilingSessions.raw(args.pageId, args.rawId))
  );

  server.registerTool(
    "coherentgt_capture_all_start",
    {
      title: "Start Full Capture",
      description:
        "Start all supported legacy WebKit profiling instruments: Timeline, ScriptProfiler, Network, Heap, and LayerTree. Use this instead of Chrome Performance/Profiler/Tracing probes.",
      inputSchema: captureAllStartInputSchema,
      annotations: { readOnlyHint: false }
    },
    async (args: z.infer<typeof captureAllStartInputSchema>) =>
      run(() =>
        profilingSessions.startAll(args.pageId, {
          reload: args.reload,
          ignoreCache: args.ignoreCache,
          maxCallStackDepth: args.maxCallStackDepth,
          timelineInstruments: args.timelineInstruments
        })
      )
  );

  server.registerTool(
    "coherentgt_capture_all_stop",
    {
      title: "Stop Full Capture",
      description: "Stop all active profiling instruments and return compact capture summaries.",
      inputSchema: profilePageInputSchema,
      annotations: { readOnlyHint: false }
    },
    async (args: z.infer<typeof profilePageInputSchema>) => run(() => profilingSessions.stop(args.pageId))
  );

  server.registerTool(
    "coherentgt_script_profile_start",
    {
      title: "Start Script Profiling",
      description: "Start legacy ScriptProfiler tracking with samples.",
      inputSchema: focusedProfileStartInputSchema,
      annotations: { readOnlyHint: false }
    },
    async (args: z.infer<typeof focusedProfileStartInputSchema>) =>
      run(() =>
        profilingSessions.start(args.pageId, {
          instruments: ["script"],
          reload: args.reload,
          ignoreCache: args.ignoreCache,
          maxCallStackDepth: args.maxCallStackDepth
        })
      )
  );

  server.registerTool(
    "coherentgt_script_profile_stop",
    {
      title: "Stop Script Profiling",
      description: "Stop legacy ScriptProfiler tracking and summarize script samples.",
      inputSchema: profilePageInputSchema,
      annotations: { readOnlyHint: false }
    },
    async (args: z.infer<typeof profilePageInputSchema>) => run(() => profilingSessions.stop(args.pageId, ["script"]))
  );

  server.registerTool(
    "coherentgt_timeline_start",
    {
      title: "Start Timeline Capture",
      description: "Start legacy Timeline capture for frame, script, layout, paint, memory, and heap allocation records.",
      inputSchema: timelineStartInputSchema,
      annotations: { readOnlyHint: false }
    },
    async (args: z.infer<typeof timelineStartInputSchema>) =>
      run(() =>
        profilingSessions.start(args.pageId, {
          instruments: ["timeline"],
          reload: args.reload,
          ignoreCache: args.ignoreCache,
          maxCallStackDepth: args.maxCallStackDepth,
          timelineInstruments: args.timelineInstruments
        })
      )
  );

  server.registerTool(
    "coherentgt_timeline_stop",
    {
      title: "Stop Timeline Capture",
      description: "Stop legacy Timeline capture and summarize frame/script/layout/paint records.",
      inputSchema: profilePageInputSchema,
      annotations: { readOnlyHint: false }
    },
    async (args: z.infer<typeof profilePageInputSchema>) => run(() => profilingSessions.stop(args.pageId, ["timeline"]))
  );

  server.registerTool(
    "coherentgt_network_capture_start",
    {
      title: "Start Network Capture",
      description: "Start Network event capture for request waterfall summaries.",
      inputSchema: focusedProfileStartInputSchema,
      annotations: { readOnlyHint: false }
    },
    async (args: z.infer<typeof focusedProfileStartInputSchema>) =>
      run(() =>
        profilingSessions.start(args.pageId, {
          instruments: ["network"],
          reload: args.reload,
          ignoreCache: args.ignoreCache,
          maxCallStackDepth: args.maxCallStackDepth
        })
      )
  );

  server.registerTool(
    "coherentgt_network_capture_stop",
    {
      title: "Stop Network Capture",
      description: "Stop Network event capture and summarize request waterfall timing.",
      inputSchema: profilePageInputSchema,
      annotations: { readOnlyHint: false }
    },
    async (args: z.infer<typeof profilePageInputSchema>) => run(() => profilingSessions.stop(args.pageId, ["network"]))
  );

  server.registerTool(
    "coherentgt_heap_snapshot",
    {
      title: "Heap Snapshot",
      description: "Take a legacy Heap.snapshot and return compact snapshot metadata plus rawId.",
      inputSchema: profilePageInputSchema
    },
    async (args: z.infer<typeof profilePageInputSchema>) => run(() => profilingSessions.heapSnapshot(args.pageId))
  );

  server.registerTool(
    "coherentgt_heap_start_tracking",
    {
      title: "Start Heap Tracking",
      description: "Start legacy Heap allocation tracking.",
      inputSchema: focusedProfileStartInputSchema,
      annotations: { readOnlyHint: false }
    },
    async (args: z.infer<typeof focusedProfileStartInputSchema>) =>
      run(() =>
        profilingSessions.start(args.pageId, {
          instruments: ["heap"],
          reload: args.reload,
          ignoreCache: args.ignoreCache,
          maxCallStackDepth: args.maxCallStackDepth
        })
      )
  );

  server.registerTool(
    "coherentgt_heap_stop_tracking",
    {
      title: "Stop Heap Tracking",
      description: "Stop legacy Heap allocation tracking and summarize heap snapshots.",
      inputSchema: profilePageInputSchema,
      annotations: { readOnlyHint: false }
    },
    async (args: z.infer<typeof profilePageInputSchema>) => run(() => profilingSessions.stop(args.pageId, ["heap"]))
  );

  server.registerTool(
    "coherentgt_heap_gc",
    {
      title: "Collect Garbage",
      description: "Mutating: request a legacy Heap.gc in the live Coherent view.",
      inputSchema: profilePageInputSchema,
      annotations: { destructiveHint: true, readOnlyHint: false }
    },
    async (args: z.infer<typeof profilePageInputSchema>) => run(() => profilingSessions.heapGc(args.pageId))
  );

  server.registerTool(
    "coherentgt_layer_tree",
    {
      title: "Layer Tree",
      description: "Enable LayerTree and optionally read layers for a nodeId or selector.",
      inputSchema: layerTreeInputSchema
    },
    async (args: z.infer<typeof layerTreeInputSchema>) => run(() => profilingSessions.layerTree(args.pageId, args))
  );

  server.registerTool(
    "coherentgt_compositing_reasons",
    {
      title: "Compositing Reasons",
      description: "Read compositing reasons for a legacy LayerTree layer id.",
      inputSchema: compositingReasonsInputSchema
    },
    async (args: z.infer<typeof compositingReasonsInputSchema>) =>
      run(() => profilingSessions.compositingReasons(args.pageId, args.layerId))
  );

  server.registerTool(
    "coherentgt_set_paint_rects_visible",
    {
      title: "Show Paint Rects",
      description: "Mutating: toggle WebInspector paint rect overlays in the live Coherent view.",
      inputSchema: visualOverlayInputSchema,
      annotations: { destructiveHint: true, readOnlyHint: false }
    },
    async (args: z.infer<typeof visualOverlayInputSchema>) =>
      run(() => profilingSessions.setPaintRectsVisible(args.pageId, args.visible))
  );

  server.registerTool(
    "coherentgt_set_compositing_borders_visible",
    {
      title: "Show Compositing Borders",
      description: "Mutating: toggle WebInspector compositing border overlays in the live Coherent view.",
      inputSchema: visualOverlayInputSchema,
      annotations: { destructiveHint: true, readOnlyHint: false }
    },
    async (args: z.infer<typeof visualOverlayInputSchema>) =>
      run(() => profilingSessions.setCompositingBordersVisible(args.pageId, args.visible))
  );

  server.registerTool(
    "coherentgt_debug_start",
    {
      title: "Start Debug Session",
      description: "Open a persistent WebInspector debugger session for breakpoints, script tracing, and paused call-frame inspection.",
      inputSchema: debugStartInputSchema
    },
    async (args: z.infer<typeof debugStartInputSchema>) =>
      run(() => debugSessions.start(args.pageId, { pauseOnExceptions: args.pauseOnExceptions }))
  );

  server.registerTool(
    "coherentgt_debug_stop",
    {
      title: "Stop Debug Session",
      description: "Close a persistent WebInspector debugger session for a view.",
      inputSchema: debugStopInputSchema
    },
    async (args: z.infer<typeof debugStopInputSchema>) => run(() => debugSessions.stop(args.pageId))
  );

  server.registerTool(
    "coherentgt_debug_status",
    {
      title: "Debug Session Status",
      description: "Show one debug session status or all active debug sessions.",
      inputSchema: debugStatusInputSchema
    },
    async (args: z.infer<typeof debugStatusInputSchema>) => run(() => debugSessions.status(args.pageId))
  );

  server.registerTool(
    "coherentgt_debug_events",
    {
      title: "Debug Events",
      description: "Read buffered debugger events such as scriptParsed, paused, breakpointResolved, and resumed.",
      inputSchema: debugEventsInputSchema
    },
    async (args: z.infer<typeof debugEventsInputSchema>) => run(() => debugSessions.events(args.pageId, args))
  );

  server.registerTool(
    "coherentgt_debug_command",
    {
      title: "Debug Session Command",
      description: "Send a raw WebInspector command over the persistent debug session.",
      inputSchema: debugCommandInputSchema
    },
    async (args: z.infer<typeof debugCommandInputSchema>) =>
      run(() => debugSessions.command(args.pageId, args.method, args.params))
  );

  server.registerTool(
    "coherentgt_debug_paused",
    {
      title: "Paused State",
      description: "Return the current Debugger.paused state, including call frames and scopes, if the view is paused.",
      inputSchema: debugPageInputSchema
    },
    async (args: z.infer<typeof debugPageInputSchema>) => run(() => debugSessions.paused(args.pageId))
  );

  server.registerTool(
    "coherentgt_debug_list_scripts",
    {
      title: "List Debug Scripts",
      description: "List scripts seen by Debugger.scriptParsed in a persistent debug session.",
      inputSchema: debugListScriptsInputSchema
    },
    async (args: z.infer<typeof debugListScriptsInputSchema>) =>
      run(() => debugSessions.scripts(args.pageId, args.urlContains))
  );

  server.registerTool(
    "coherentgt_debug_get_script_source",
    {
      title: "Get Script Source",
      description: "Read script source by WebInspector scriptId.",
      inputSchema: debugGetScriptSourceInputSchema
    },
    async (args: z.infer<typeof debugGetScriptSourceInputSchema>) =>
      run(() => debugSessions.getScriptSource(args.pageId, args.scriptId))
  );

  server.registerTool(
    "coherentgt_debug_search_script",
    {
      title: "Search Script",
      description: "Search one script by WebInspector scriptId.",
      inputSchema: debugSearchScriptInputSchema
    },
    async (args: z.infer<typeof debugSearchScriptInputSchema>) =>
      run(() => debugSessions.searchScript(args.pageId, args))
  );

  server.registerTool(
    "coherentgt_debug_search_all_scripts",
    {
      title: "Search All Scripts",
      description: "Search scripts seen by the persistent debugger session, optionally filtered by URL.",
      inputSchema: debugSearchAllScriptsInputSchema
    },
    async (args: z.infer<typeof debugSearchAllScriptsInputSchema>) =>
      run(() => debugSessions.searchAllScripts(args.pageId, args))
  );

  server.registerTool(
    "coherentgt_debug_set_breakpoint_by_url",
    {
      title: "Set URL Breakpoint",
      description: "Set a JavaScript breakpoint by URL and 0-based line/column. Mutating: pauses live UI execution when hit.",
      inputSchema: debugSetBreakpointByUrlInputSchema,
      annotations: { destructiveHint: true, readOnlyHint: false }
    },
    async (args: z.infer<typeof debugSetBreakpointByUrlInputSchema>) =>
      run(() => debugSessions.setBreakpointByUrl(args.pageId, args))
  );

  server.registerTool(
    "coherentgt_debug_set_breakpoint",
    {
      title: "Set Script Breakpoint",
      description: "Set a JavaScript breakpoint by scriptId and 0-based line/column. Mutating: pauses live UI execution when hit.",
      inputSchema: debugSetBreakpointInputSchema,
      annotations: { destructiveHint: true, readOnlyHint: false }
    },
    async (args: z.infer<typeof debugSetBreakpointInputSchema>) =>
      run(() => debugSessions.setBreakpoint(args.pageId, args))
  );

  server.registerTool(
    "coherentgt_debug_remove_breakpoint",
    {
      title: "Remove Breakpoint",
      description: "Remove a JavaScript, event-listener, XHR, or DOM breakpoint from a debug session.",
      inputSchema: debugRemoveBreakpointInputSchema,
      annotations: { destructiveHint: true, readOnlyHint: false }
    },
    async (args: z.infer<typeof debugRemoveBreakpointInputSchema>) =>
      run(() => debugSessions.removeBreakpoint(args.pageId, args.breakpointId))
  );

  server.registerTool(
    "coherentgt_debug_list_breakpoints",
    {
      title: "List Breakpoints",
      description: "List breakpoints registered through this MCP debug session.",
      inputSchema: debugPageInputSchema
    },
    async (args: z.infer<typeof debugPageInputSchema>) => run(() => debugSessions.breakpoints(args.pageId))
  );

  server.registerTool(
    "coherentgt_debug_pause",
    {
      title: "Pause JavaScript",
      description: "Mutating: pause JavaScript execution in the live Coherent view.",
      inputSchema: debugPageInputSchema,
      annotations: { destructiveHint: true, readOnlyHint: false }
    },
    async (args: z.infer<typeof debugPageInputSchema>) => run(() => debugSessions.command(args.pageId, "Debugger.pause"))
  );

  server.registerTool(
    "coherentgt_debug_resume",
    {
      title: "Resume JavaScript",
      description: "Mutating: resume paused JavaScript execution in the live Coherent view.",
      inputSchema: debugPageInputSchema,
      annotations: { destructiveHint: true, readOnlyHint: false }
    },
    async (args: z.infer<typeof debugPageInputSchema>) => run(() => debugSessions.command(args.pageId, "Debugger.resume"))
  );

  for (const [name, title, method] of [
    ["coherentgt_debug_step_over", "Step Over", "Debugger.stepOver"],
    ["coherentgt_debug_step_into", "Step Into", "Debugger.stepInto"],
    ["coherentgt_debug_step_out", "Step Out", "Debugger.stepOut"]
  ] as const) {
    server.registerTool(
      name,
      {
        title,
        description: `Mutating: ${title.toLowerCase()} from the current paused call frame.`,
        inputSchema: debugPageInputSchema,
        annotations: { destructiveHint: true, readOnlyHint: false }
      },
      async (args: z.infer<typeof debugPageInputSchema>) => run(() => debugSessions.command(args.pageId, method))
    );
  }

  server.registerTool(
    "coherentgt_debug_evaluate_on_call_frame",
    {
      title: "Evaluate On Call Frame",
      description: "Evaluate JavaScript in a paused call frame. If callFrameId is omitted, the top paused frame is used.",
      inputSchema: debugEvaluateInputSchema
    },
    async (args: z.infer<typeof debugEvaluateInputSchema>) =>
      run(() => debugSessions.evaluateOnCallFrame(args.pageId, args))
  );

  server.registerTool(
    "coherentgt_debug_set_event_listener_breakpoint",
    {
      title: "Set Event Listener Breakpoint",
      description: "Mutating: pause when a named event listener, such as click or input, fires in the live view.",
      inputSchema: debugEventBreakpointInputSchema,
      annotations: { destructiveHint: true, readOnlyHint: false }
    },
    async (args: z.infer<typeof debugEventBreakpointInputSchema>) =>
      run(() => debugSessions.setEventListenerBreakpoint(args.pageId, args.eventName))
  );

  server.registerTool(
    "coherentgt_debug_set_xhr_breakpoint",
    {
      title: "Set XHR Breakpoint",
      description: "Mutating: pause when XHR/fetch activity matches the URL substring. Empty string pauses on all XHR.",
      inputSchema: debugXhrBreakpointInputSchema,
      annotations: { destructiveHint: true, readOnlyHint: false }
    },
    async (args: z.infer<typeof debugXhrBreakpointInputSchema>) =>
      run(() => debugSessions.setXhrBreakpoint(args.pageId, args.url))
  );

  server.registerTool(
    "coherentgt_debug_set_dom_breakpoint",
    {
      title: "Set DOM Breakpoint",
      description: "Mutating: pause when the selected DOM node is modified or removed.",
      inputSchema: debugDomBreakpointInputSchema,
      annotations: { destructiveHint: true, readOnlyHint: false }
    },
    async (args: z.infer<typeof debugDomBreakpointInputSchema>) =>
      run(() => debugSessions.setDomBreakpoint(args.pageId, args))
  );

  return server;
}

function createIdleShutdown(timeoutMs: number, onIdle: () => Promise<void>, enabled: boolean): { reset: () => void } {
  let timer: NodeJS.Timeout | undefined;

  const reset = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }

    if (!enabled || timeoutMs === 0) {
      return;
    }

    timer = setTimeout(() => {
      onIdle().catch((error) => {
        console.error(error instanceof Error ? error.stack ?? error.message : error);
        process.exit(1);
      });
    }, timeoutMs);
  };

  reset();
  return { reset };
}

function hasInspectorError(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    "response" in value &&
    !!(value as { response?: { error?: unknown } }).response?.error
  );
}
