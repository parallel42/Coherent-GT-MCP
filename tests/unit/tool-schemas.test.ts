import { describe, expect, it } from "vitest";
import {
  captureAllStartInputSchema,
  consoleSnapshotInputSchema,
  diagnosePageInputSchema,
  debugSetBreakpointByUrlInputSchema,
  debugStartInputSchema,
  evaluateInputSchema,
  eventListenersInputSchema,
  evalJsInputSchema,
  imageProbeInputSchema,
  inspectSelectorInputSchema,
  listPagesInputSchema,
  networkSnapshotInputSchema,
  pageHealthInputSchema,
  inspectorCommandInputSchema,
  layerTreeInputSchema,
  navigateViewInputSchema,
  outerHtmlInputSchema,
  profileCapabilitiesInputSchema,
  profileEventsInputSchema,
  profileRawInputSchema,
  releaseAllInputSchema,
  releasePageInputSchema,
  profileStartInputSchema,
  resultReadInputSchema,
  resultSearchInputSchema,
  runtimeErrorsInputSchema,
  traceEventsInputSchema,
  resourceContentInputSchema,
  resourceProbeInputSchema,
  resourceSearchInputSchema,
  setStyleInputSchema,
  visualOverlayInputSchema
} from "../../src/tools/schemas.js";

describe("tool schemas", () => {
  it("accepts valid inspector command input", () => {
    expect(
      inspectorCommandInputSchema.parse({
        pageId: 1,
        method: "Runtime.evaluate",
        params: { expression: "document.title" }
      })
    ).toEqual({
      pageId: 1,
      method: "Runtime.evaluate",
      params: { expression: "document.title" }
    });
  });

  it("accepts generic diagnostic inputs with defaults", () => {
    expect(
      listPagesInputSchema.parse({
        titleContains: "main"
      })
    ).toEqual({
      titleContains: "main"
    });

    expect(
      evaluateInputSchema.parse({
        pageId: 2,
        expression: "document.title"
      })
    ).toEqual({
      pageId: 2,
      expression: "document.title",
      awaitPromise: true,
      returnByValue: true,
      risk: "unknown"
    });

    expect(consoleSnapshotInputSchema.parse({ pageId: 2 })).toEqual({
      pageId: 2,
      levels: ["error", "warning"],
      maxEvents: 50
    });

    expect(runtimeErrorsInputSchema.parse({ pageId: 2 })).toEqual({
      pageId: 2,
      maxEvents: 50
    });

    expect(pageHealthInputSchema.parse({ pageId: 2 })).toEqual({
      pageId: 2,
      sampleMs: 750
    });

    expect(networkSnapshotInputSchema.parse({ pageId: 2 })).toEqual({
      pageId: 2,
      maxEvents: 500,
      maxPayloadChars: 240
    });

    expect(eventListenersInputSchema.parse({ pageId: 2 })).toEqual({
      pageId: 2,
      selector: "document"
    });

    expect(traceEventsInputSchema.parse({ pageId: 2 })).toEqual({
      pageId: 2,
      timeoutMs: 1000,
      maxEvents: 100
    });

    expect(diagnosePageInputSchema.parse({})).toEqual({
      sampleMs: 750,
      consoleLevels: ["error", "warning"]
    });
  });

  it("rejects invalid page ids", () => {
    expect(() =>
      evalJsInputSchema.parse({
        pageId: -1,
        expression: "document.title"
      })
    ).toThrow();
  });

  it("rejects invalid navigation URLs", () => {
    expect(() =>
      navigateViewInputSchema.parse({
        pageId: 1,
        url: "not a url"
      })
    ).toThrow();
  });

  it("accepts style maps", () => {
    expect(
      setStyleInputSchema.parse({
        pageId: 1,
        selector: "body",
        styles: {
          outline: "1px solid red"
        }
      })
    ).toEqual({
      pageId: 1,
      selector: "body",
      styles: {
        outline: "1px solid red"
      }
    });
  });

  it("accepts resource inspection inputs", () => {
    expect(
      resourceContentInputSchema.parse({
        pageId: 30,
        url: "coui://example/resources/view.html"
      })
    ).toEqual({
      pageId: 30,
      url: "coui://example/resources/view.html"
    });

    expect(
      resourceSearchInputSchema.parse({
        pageId: 30,
        url: "coui://example/resources/view.html",
        query: "needle"
      })
    ).toEqual({
      pageId: 30,
      url: "coui://example/resources/view.html",
      query: "needle",
      caseSensitive: false,
      isRegex: false
    });
  });

  it("accepts generic selector and resource probe inputs", () => {
    expect(
      inspectSelectorInputSchema.parse({
        pageId: 30,
        selector: "body",
        includeMatchedRules: true
      })
    ).toEqual({
      pageId: 30,
      selector: "body",
      includeComputedStyle: true,
      includeMatchedRules: true,
      includeOuterHtml: true
    });

    expect(
      resourceProbeInputSchema.parse({
        pageId: 30,
        url: "coui://example/assets/icon.png"
      })
    ).toEqual({
      pageId: 30,
      url: "coui://example/assets/icon.png",
      includeContent: true,
      includeNetwork: true
    });

    expect(imageProbeInputSchema.parse({ pageId: 30, url: "coui://example/assets/icon.png" })).toEqual({
      pageId: 30,
      url: "coui://example/assets/icon.png",
      timeoutMs: 5000,
      includeResourceProbe: true
    });
  });

  it("accepts requested probes on page diagnostics", () => {
    expect(
      diagnosePageInputSchema.parse({
        pageId: 30,
        selectors: ["body"],
        resources: ["coui://example/assets/app.js"],
        images: ["coui://example/assets/icon.png"]
      })
    ).toEqual({
      pageId: 30,
      sampleMs: 750,
      consoleLevels: ["error", "warning"],
      selectors: ["body"],
      resources: ["coui://example/assets/app.js"],
      images: ["coui://example/assets/icon.png"]
    });
  });

  it("accepts selector or nodeId for outerHTML", () => {
    expect(
      outerHtmlInputSchema.parse({
        pageId: 30,
        selector: "body"
      })
    ).toEqual({
      pageId: 30,
      selector: "body"
    });
  });

  it("accepts persistent debugger inputs", () => {
    expect(
      debugStartInputSchema.parse({
        pageId: 30
      })
    ).toEqual({
      pageId: 30,
      pauseOnExceptions: "none"
    });

    expect(
      debugSetBreakpointByUrlInputSchema.parse({
        pageId: 30,
        url: "coui://example/resources/script.js",
        lineNumber: 0
      })
    ).toEqual({
      pageId: 30,
      url: "coui://example/resources/script.js",
      lineNumber: 0,
      columnNumber: 0
    });
  });

  it("accepts profiling capture inputs with defaults", () => {
    expect(
      profileStartInputSchema.parse({
        pageId: 31
      })
    ).toEqual({
      pageId: 31,
      instruments: ["timeline", "script", "network"],
      reload: false,
      ignoreCache: false,
      maxCallStackDepth: 128
    });

    expect(
      captureAllStartInputSchema.parse({
        pageId: 31,
        reload: true,
        timelineInstruments: ["Timeline", "Memory"]
      })
    ).toEqual({
      pageId: 31,
      reload: true,
      ignoreCache: false,
      maxCallStackDepth: 128,
      timelineInstruments: ["Timeline", "Memory"]
    });
  });

  it("accepts profiling capabilities input only as an empty object", () => {
    expect(profileCapabilitiesInputSchema.parse({})).toEqual({});
    expect(() => profileCapabilitiesInputSchema.parse({ pageId: 31 })).toThrow();
  });

  it("accepts cached result read and search inputs", () => {
    expect(
      resultReadInputSchema.parse({
        resultId: "result_abc",
        offsetBytes: 10
      })
    ).toEqual({
      resultId: "result_abc",
      offsetBytes: 10
    });

    expect(
      resultSearchInputSchema.parse({
        resultId: "result_abc",
        query: "needle"
      })
    ).toEqual({
      resultId: "result_abc",
      query: "needle",
      caseSensitive: false,
      isRegex: false,
      maxMatches: 20,
      contextChars: 160
    });
  });

  it("accepts persistent session release inputs", () => {
    expect(releasePageInputSchema.parse({ pageId: 31 })).toEqual({ pageId: 31 });
    expect(releaseAllInputSchema.parse({})).toEqual({});
    expect(() => releaseAllInputSchema.parse({ pageId: 31 })).toThrow();
  });

  it("accepts profiling event and raw payload reads", () => {
    expect(
      profileEventsInputSchema.parse({
        pageId: 31,
        eventTypes: ["Network.requestWillBeSent"],
        includeParams: true
      })
    ).toEqual({
      pageId: 31,
      maxEvents: 100,
      eventTypes: ["Network.requestWillBeSent"],
      includeParams: true
    });

    expect(
      profileRawInputSchema.parse({
        pageId: 31,
        rawId: "heap-snapshot:1"
      })
    ).toEqual({
      pageId: 31,
      rawId: "heap-snapshot:1"
    });
  });

  it("accepts layer and visual overlay inputs", () => {
    expect(
      layerTreeInputSchema.parse({
        pageId: 31,
        selector: "body"
      })
    ).toEqual({
      pageId: 31,
      selector: "body"
    });

    expect(
      visualOverlayInputSchema.parse({
        pageId: 31,
        visible: true
      })
    ).toEqual({
      pageId: 31,
      visible: true
    });
  });
});
