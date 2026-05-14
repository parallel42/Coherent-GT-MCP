import { describe, expect, it } from "vitest";
import { buildSetStyleExpression } from "../../src/tools/css.js";
import { buildQuerySelectorExpression } from "../../src/tools/dom.js";
import { buildClickExpression } from "../../src/tools/events.js";
import { buildEngineCallExpression, buildEngineTriggerExpression } from "../../src/tools/runtime.js";
import { jsonToolResult } from "../../src/tools/result.js";

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
});
