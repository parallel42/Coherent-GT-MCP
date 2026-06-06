import { describe, expect, it } from "vitest";
import { summarizeSelectorInspection } from "../../src/tools/selector-inspection.js";

describe("selector inspection", () => {
  it("summarizes visibility from computed style and box model", () => {
    expect(
      summarizeSelectorInspection({
        selector: "body",
        nodeId: 42,
        computedStyle: [
          { name: "display", value: "block" },
          { name: "visibility", value: "visible" },
          { name: "opacity", value: "1" }
        ],
        boxModel: {
          model: {
            width: 640,
            height: 480,
            content: [0, 0, 640, 0, 640, 480, 0, 480]
          }
        },
        outerHTML: "<body></body>"
      })
    ).toMatchObject({
      selector: "body",
      found: true,
      nodeId: 42,
      visibility: {
        display: "block",
        visibility: "visible",
        opacity: 1,
        hasBox: true,
        visible: true
      },
      boundingBox: { x: 0, y: 0, width: 640, height: 480 }
    });
  });

  it("marks display none nodes as not visible", () => {
    expect(
      summarizeSelectorInspection({
        selector: "body",
        nodeId: 42,
        computedStyle: [{ name: "display", value: "none" }]
      })
    ).toMatchObject({
      found: true,
      visibility: {
        display: "none",
        visible: false
      }
    });
  });
});
