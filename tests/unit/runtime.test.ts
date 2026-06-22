import { describe, expect, it } from "vitest";
import { buildSetStyleExpression } from "../../src/tools/css.js";
import { buildQuerySelectorExpression } from "../../src/tools/dom.js";
import { buildClickExpression } from "../../src/tools/events.js";
import { buildEngineCallExpression, buildEngineDiagnosticsExpression, buildEngineTriggerExpression } from "../../src/tools/runtime.js";
import { jsonToolResult, ToolResultStore } from "../../src/tools/result.js";

describe("generated JavaScript snippets", () => {
  it("escapes engine trigger arguments through JSON.stringify", () => {
    const expression = buildEngineTriggerExpression('event"name', ['value"); throw new Error("bad")']);

    expect(expression).toContain(JSON.stringify('event"name'));
    expect(expression).toContain(JSON.stringify(['value"); throw new Error("bad")']));
    expect(expression).not.toContain('engine.trigger(event"name');
  });

  it("escapes engine call arguments through JSON.stringify", () => {
    const expression = buildEngineCallExpression("fn", ['"); location.href="bad']);

    expect(expression).toContain(JSON.stringify("fn"));
    expect(expression).toContain(JSON.stringify(['"); location.href="bad']));
  });

  it("builds a legacy-safe engine diagnostics expression", () => {
    const expression = buildEngineDiagnosticsExpression();

    expect(expression).toContain("globalThis.engine");
    expect(expression).toContain("TriggerEvent");
    expect(expression).toContain("SendMessage");
    expect(expression).not.toContain("Object.fromEntries");
    expect(expression).not.toContain("...");
  });

  it("escapes CSS selector and styles through JSON.stringify", () => {
    const expression = buildSetStyleExpression({
      selector: 'body[data-x="quote"]',
      styles: {
        content: '"quoted"'
      }
    });

    expect(expression).toContain(JSON.stringify('body[data-x="quote"]'));
    expect(expression).toContain(JSON.stringify({ content: '"quoted"' }));
  });

  it("escapes click selectors through JSON.stringify", () => {
    const selector = 'button[aria-label="Click"]';
    expect(buildClickExpression(selector)).toContain(JSON.stringify(selector));
  });

  it("avoids modern APIs unsupported by older Coherent WebKit", () => {
    const snippets = [
      buildQuerySelectorExpression({ selector: "body", includeComputedStyle: true }),
      buildSetStyleExpression({ selector: "body", styles: { outline: "1px solid red" } }),
      buildClickExpression("body")
    ];

    for (const snippet of snippets) {
      expect(snippet).not.toContain("Object.fromEntries");
      expect(snippet).not.toContain("Array.from");
      expect(snippet).not.toContain("...");
    }
  });

  it("keeps oversized JSON tool results parseable", () => {
    const result = jsonToolResult({ value: "x".repeat(200) }, 50);
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(JSON.parse(text)).toMatchObject({
      truncated: true,
      maxTextBytes: 50
    });
  });

  it("caches oversized JSON tool results with read and search affordances", () => {
    const store = new ToolResultStore();
    const result = jsonToolResult(
      {
        value: `alpha ${"x".repeat(200)} omega`
      },
      1000,
      {
        resultStore: store,
        inlineMaxBytes: 80,
        previewBytes: 30
      }
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    const payload = JSON.parse(text);

    expect(payload).toMatchObject({
      partial: true,
      originalBytes: expect.any(Number),
      next: {
        read: {
          tool: "coherentgt_result_read"
        },
        search: {
          tool: "coherentgt_result_search"
        }
      }
    });
    expect(payload.resultId).toMatch(/^result_/);

    expect(store.read({ resultId: payload.resultId, offsetBytes: payload.previewBytes, maxBytes: 40 })).toMatchObject({
      resultId: payload.resultId,
      totalBytes: payload.originalBytes,
      returnedBytes: expect.any(Number)
    });

    expect(
      store.search({
        resultId: payload.resultId,
        query: "omega",
        maxMatches: 5,
        contextChars: 20
      })
    ).toMatchObject({
      resultId: payload.resultId,
      returnedMatches: 1,
      matches: [
        {
          matchText: "omega"
        }
      ]
    });
  });
});
