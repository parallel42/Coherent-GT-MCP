import { describe, expect, it } from "vitest";
import {
  captureAllStartInputSchema,
  debugSetBreakpointByUrlInputSchema,
  debugStartInputSchema,
  evalJsInputSchema,
  inspectorCommandInputSchema,
  layerTreeInputSchema,
  navigateViewInputSchema,
  outerHtmlInputSchema,
  profileEventsInputSchema,
  profileRawInputSchema,
  profileStartInputSchema,
  resourceContentInputSchema,
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
        url: "coui://html_UI/ingamePanels/P42Flow/P42Flow.html"
      })
    ).toEqual({
      pageId: 30,
      url: "coui://html_UI/ingamePanels/P42Flow/P42Flow.html"
    });

    expect(
      resourceSearchInputSchema.parse({
        pageId: 30,
        url: "coui://html_UI/ingamePanels/P42Flow/P42Flow.html",
        query: "Flow"
      })
    ).toEqual({
      pageId: 30,
      url: "coui://html_UI/ingamePanels/P42Flow/P42Flow.html",
      query: "Flow",
      caseSensitive: false,
      isRegex: false
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
        url: "coui://html_UI/ingamePanels/P42Flow/P42Flow.js",
        lineNumber: 0
      })
    ).toEqual({
      pageId: 30,
      url: "coui://html_UI/ingamePanels/P42Flow/P42Flow.js",
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
