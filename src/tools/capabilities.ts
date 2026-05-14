export function coherentgtProfileCapabilities(): Record<string, unknown> {
  return {
    protocol: "Legacy WebKit Inspector as exposed by Coherent GT",
    agentGuidance: [
      "Do not probe Chrome-only domains first. Coherent GT targets normally do not expose Performance, Profiler, Tracing, HeapProfiler, DOMSnapshot, or Runtime.getHeapUsage.",
      "Use the MCP profiling tools first. They wrap the legacy Timeline, ScriptProfiler, Network, Heap, LayerTree, and Page overlay commands and return compact summaries.",
      "If these profiling tools are missing from an agent session, the MCP client has stale tool metadata or is connected to an older server. Restart the MCP client/session and verify the shared Docker endpoint lists the profiling tools."
    ],
    recommendedFlow: [
      "coherentgt_list_views({})",
      "coherentgt_capture_all_start({ pageId, reload: true })",
      "Reproduce the slow interaction or wait for the page to finish loading.",
      "coherentgt_capture_all_stop({ pageId })",
      "Use coherentgt_profile_events({ pageId, includeParams: true }) or coherentgt_profile_raw({ pageId, rawId }) only when the compact summary is not enough."
    ],
    legacyReplacements: {
      "Chrome Performance domain": ["coherentgt_capture_all_start", "coherentgt_timeline_start"],
      "Chrome Profiler domain": ["coherentgt_script_profile_start"],
      "Chrome Tracing domain": ["coherentgt_timeline_start", "coherentgt_profile_events"],
      "Chrome HeapProfiler or Runtime.getHeapUsage": [
        "coherentgt_heap_snapshot",
        "coherentgt_heap_start_tracking",
        "coherentgt_heap_stop_tracking",
        "coherentgt_heap_gc"
      ],
      "Chrome network waterfall": ["coherentgt_network_capture_start", "coherentgt_network_capture_stop"],
      "Chrome layer/compositing panels": [
        "coherentgt_layer_tree",
        "coherentgt_compositing_reasons",
        "coherentgt_set_paint_rects_visible",
        "coherentgt_set_compositing_borders_visible"
      ]
    },
    availableTelemetry: {
      timeline: "Frame, script, layout, paint, composite, network, memory, and heap-allocation record grouping when the target emits Timeline.eventRecorded.",
      script: "Legacy ScriptProfiler tracking summaries and retained raw payloads when the target emits tracking data.",
      network: "Aggregated request rows from Network request/response/data/finish/failure events.",
      heap: "Legacy Heap.snapshot metadata and allocation tracking events when supported by the target.",
      layerTree: "Layer tree and compositing reasons when LayerTree commands are supported by the target.",
      visualOverlays: "Paint rect and compositing border toggles through legacy Page overlay commands."
    },
    limitations: [
      "This is not a Chrome DevTools CPU flamegraph.",
      "Heap support depends on the Coherent target exposing legacy Heap commands.",
      "Captures observe future activity. Use reload: true after setup when startup and network waterfalls matter.",
      "Default stop/snapshot responses are compact; raw payloads are intentionally retained behind rawId values."
    ]
  };
}
