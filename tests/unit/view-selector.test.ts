import { describe, expect, it } from "vitest";
import { buildWebsocketUrl, toInspectableView } from "../../src/coherent/debugger-client.js";
import fixture from "../fixtures/pagelist.json" assert { type: "json" };

describe("Coherent debugger view URL handling", () => {
  it("builds a websocket URL for alternate host targets", () => {
    expect(buildWebsocketUrl("http://debugger.example.local:19999", 12)).toBe(
      "ws://debugger.example.local:19999/devtools/page/12"
    );
  });

  it("builds a websocket URL for local host targets", () => {
    expect(buildWebsocketUrl("http://127.0.0.1:19999", 4)).toBe("ws://127.0.0.1:19999/devtools/page/4");
  });

  it("normalizes fixture entries into inspectable views", () => {
    const views = fixture.map((entry) => toInspectableView("http://debugger.example.local:19999", entry));

    expect(views).toEqual([
      {
        id: 1,
        title: "MAIN UI",
        url: "coui://html_ui/Main/index.html",
        inspectorUrl: "http://127.0.0.1:19999/devtools/page/1",
        websocketUrl: "ws://debugger.example.local:19999/devtools/page/1"
      },
      {
        id: 2,
        title: "Toolbar",
        url: "coui://html_ui/Toolbar/index.html",
        inspectorUrl: "http://127.0.0.1:19999/devtools/page/2",
        websocketUrl: "ws://debugger.example.local:19999/devtools/page/2"
      }
    ]);
  });
});
