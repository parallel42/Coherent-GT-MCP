import { describe, expect, it } from "vitest";
import type { InspectorEvent } from "../../src/coherent/protocol.js";
import {
  buildHeapSummary,
  buildLayerSummary,
  buildNetworkWaterfall,
  buildScriptProfileSummary,
  buildTimelineSummary,
  type RawArtifact
} from "../../src/tools/profiling.js";

describe("profiling summaries", () => {
  it("aggregates network events into waterfall rows", () => {
    const events: InspectorEvent[] = [
      {
        method: "Network.requestWillBeSent",
        params: {
          requestId: "1",
          timestamp: 10,
          type: "Script",
          documentURL: "coui://page.html",
          request: { url: "coui://app.js", method: "GET" }
        }
      },
      {
        method: "Network.responseReceived",
        params: {
          requestId: "1",
          timestamp: 12,
          type: "Script",
          response: { url: "coui://app.js", status: 200, statusText: "OK", mimeType: "text/javascript" }
        }
      },
      {
        method: "Network.dataReceived",
        params: {
          requestId: "1",
          dataLength: 50,
          encodedDataLength: 25
        }
      },
      {
        method: "Network.loadingFinished",
        params: {
          requestId: "1",
          timestamp: 15
        }
      }
    ];

    expect(buildNetworkWaterfall(events)).toEqual({
      requestCount: 1,
      requests: [
        {
          requestId: "1",
          dataLength: 50,
          encodedDataLength: 25,
          url: "coui://app.js",
          method: "GET",
          type: "Script",
          startTime: 10,
          documentURL: "coui://page.html",
          redirected: false,
          responseTime: 12,
          status: 200,
          statusText: "OK",
          mimeType: "text/javascript",
          endTime: 15,
          latency: 2,
          receiveDuration: 3,
          duration: 5
        }
      ]
    });
  });

  it("groups timeline records by useful profiling category", () => {
    const events: InspectorEvent[] = [
      {
        method: "Timeline.eventRecorded",
        params: {
          record: {
            type: "RenderingFrame",
            startTime: 0,
            endTime: 20,
            children: [
              { type: "Layout", startTime: 1, endTime: 4 },
              { type: "Paint", startTime: 4, endTime: 9 },
              { type: "FunctionCall", startTime: 9, endTime: 10 }
            ]
          }
        }
      }
    ];

    expect(buildTimelineSummary(events)).toEqual({
      recordCount: 4,
      counts: {
        frame: 1,
        layout: 1,
        paint: 1,
        script: 1
      },
      durations: {
        frame: 20,
        layout: 3,
        paint: 5,
        script: 1
      }
    });
  });

  it("summarizes script, heap, and layer artifacts", () => {
    const artifacts = new Map<string, RawArtifact>([
      [
        "script-samples:1",
        {
          rawId: "script-samples:1",
          kind: "script-samples",
          createdAt: "2026-05-14T00:00:00.000Z",
          byteLength: 20,
          value: { stackTraces: [{ timestamp: 1 }] }
        }
      ],
      [
        "heap-snapshot:1",
        {
          rawId: "heap-snapshot:1",
          kind: "heap-snapshot",
          createdAt: "2026-05-14T00:00:01.000Z",
          byteLength: 100,
          value: "snapshot"
        }
      ]
    ]);
    const events: InspectorEvent[] = [
      { method: "ScriptProfiler.trackingStart", params: { timestamp: 1 } },
      {
        method: "ScriptProfiler.trackingComplete",
        params: { rawId: "script-samples:1", samples: { stackTraces: [{ timestamp: 1 }, { timestamp: 2 }] } }
      },
      { method: "Heap.trackingStart", params: { timestamp: 1 } },
      { method: "Heap.garbageCollected", params: { collection: { type: "full" } } },
      { method: "LayerTree.layerTreeDidChange", params: {} }
    ];

    expect(buildScriptProfileSummary(events, artifacts)).toEqual({
      started: 1,
      updates: 0,
      completed: 1,
      sampleCount: 2,
      rawIds: ["script-samples:1"]
    });
    expect(buildHeapSummary(events, artifacts)).toEqual({
      trackingStarts: 1,
      trackingCompletes: 0,
      garbageCollections: 1,
      snapshotCount: 1,
      snapshots: [
        {
          rawId: "heap-snapshot:1",
          createdAt: "2026-05-14T00:00:01.000Z",
          byteLength: 100,
          valid: true
        }
      ]
    });
    expect(buildLayerSummary(events)).toEqual({ layerTreeChangeCount: 1 });
  });
});
