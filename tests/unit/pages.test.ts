import { describe, expect, it } from "vitest";
import { filterInspectableViews, toPageSummary } from "../../src/tools/pages.js";
import type { InspectableView } from "../../src/coherent/protocol.js";

const views: InspectableView[] = [
  {
    id: 2,
    title: "Main View",
    url: "coui://example/views/main.html",
    inspectorUrl: "/inspector/Main.html?page=2",
    websocketUrl: "ws://debugger.example.local:19999/devtools/page/2"
  },
  {
    id: 9,
    title: "Secondary View",
    url: "coui://example/views/secondary.html",
    inspectorUrl: "http://127.0.0.1:19999/inspector/Main.html?page=9",
    websocketUrl: "ws://debugger.example.local:19999/devtools/page/9"
  }
];

describe("page summaries", () => {
  it("normalizes relative inspector URLs against the debugger URL", () => {
    expect(toPageSummary("http://debugger.example.local:19999", views[0]!)).toEqual({
      id: 2,
      title: "Main View",
      url: "coui://example/views/main.html",
      inspectorUrl: "http://debugger.example.local:19999/inspector/Main.html?page=2",
      websocketUrl: "ws://debugger.example.local:19999/devtools/page/2"
    });
  });

  it("filters pages by title and URL without case sensitivity", () => {
    expect(filterInspectableViews(views, { titleContains: "main", urlContains: "views" }).map((view) => view.id)).toEqual([2]);
  });
});
