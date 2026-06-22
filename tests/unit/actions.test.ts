import { describe, expect, it } from "vitest";
import type { InspectorCommandResult } from "../../src/coherent/protocol.js";
import { activateWithInspectorSend, summarizeActionState } from "../../src/tools/actions.js";

type SentCommand = {
  method: string;
  params?: object | undefined;
};

describe("action reliability helpers", () => {
  it("dispatches trusted pointer input and reports a failed postcondition separately from dispatch success", async () => {
    const sent: SentCommand[] = [];
    const send = createActionSend(sent, [
      runtimeValue({
        title: "MAIN UI",
        href: "coui://main",
        readyState: "complete",
        targetText: "CTRL\nStart flight",
        targetRect: { x: 10, y: 20, width: 100, height: 40 }
      }),
      okResult(),
      okResult(),
      runtimeValue(false),
      runtimeValue({
        title: "MAIN UI",
        href: "coui://main",
        readyState: "complete",
        targetText: "CTRL\nStart flight",
        targetRect: { x: 10, y: 20, width: 100, height: 40 }
      })
    ]);

    await expect(
      activateWithInspectorSend(send, {
        pageId: 42,
        activation: "trusted-click",
        selector: "ui-resource-element",
        postconditionExpression: "document.body.textContent.indexOf('Start flight') === -1",
        postDelayMs: 0
      })
    ).resolves.toMatchObject({
      pageId: 42,
      activation: "trusted-click",
      dispatch: {
        dispatched: true,
        method: "Input.dispatchMouseEvent",
        coordinates: { x: 60, y: 40 }
      },
      postcondition: {
        evaluated: true,
        ok: false,
        value: false
      },
      stateChange: {
        noStateChange: true
      },
      pageReachableAfter: true,
      warnings: ["Target text and page identity were unchanged after activation; action may have been ignored by native Coherent UI."]
    });

    expect(sent.map((entry) => entry.method)).toEqual([
      "Runtime.evaluate",
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
      "Runtime.evaluate",
      "Runtime.evaluate"
    ]);
    expect(sent[1]?.params).toMatchObject({ type: "mousePressed", x: 60, y: 40, button: "left" });
    expect(sent[2]?.params).toMatchObject({ type: "mouseReleased", x: 60, y: 40, button: "left" });
  });

  it("returns unsupported trusted input without evaluating postconditions when the inspector domain rejects input dispatch", async () => {
    const sent: SentCommand[] = [];
    const send = createActionSend(sent, [
      runtimeValue({
        title: "MAIN UI",
        href: "coui://main",
        readyState: "complete",
        targetText: "Start flight",
        targetRect: { x: 5, y: 5, width: 20, height: 10 }
      }),
      errorResult("Input.dispatchMouseEvent is not supported")
    ]);

    await expect(
      activateWithInspectorSend(send, {
        pageId: 42,
        activation: "trusted-click",
        x: 15,
        y: 10,
        postconditionExpression: "true",
        postDelayMs: 0
      })
    ).resolves.toMatchObject({
      dispatch: {
        dispatched: false,
        method: "Input.dispatchMouseEvent",
        error: "Input.dispatchMouseEvent is not supported"
      },
      postcondition: {
        evaluated: false
      },
      warnings: ["Trusted pointer input is not supported by this Coherent WebInspector target."]
    });

    expect(sent.map((entry) => entry.method)).toEqual(["Runtime.evaluate", "Input.dispatchMouseEvent"]);
  });

  it("summarizes unchanged target state as a no-op candidate", () => {
    expect(
      summarizeActionState(
        { title: "MAIN UI", href: "coui://main", readyState: "complete", targetText: "Start flight" },
        { title: "MAIN UI", href: "coui://main", readyState: "complete", targetText: "Start flight" }
      )
    ).toEqual({
      before: { title: "MAIN UI", href: "coui://main", readyState: "complete", targetText: "Start flight" },
      after: { title: "MAIN UI", href: "coui://main", readyState: "complete", targetText: "Start flight" },
      noStateChange: true
    });
  });
});

function createActionSend(sent: SentCommand[], responses: InspectorCommandResult[]) {
  return async (method: string, params?: object): Promise<InspectorCommandResult> => {
    sent.push({ method, params });
    const response = responses.shift();
    if (!response) {
      throw new Error(`Unexpected command: ${method}`);
    }
    return response;
  };
}

function okResult(): InspectorCommandResult {
  return {
    response: {
      id: 1,
      result: {}
    },
    events: []
  };
}

function errorResult(message: string): InspectorCommandResult {
  return {
    response: {
      id: 1,
      error: { message }
    },
    events: []
  };
}

function runtimeValue(value: unknown): InspectorCommandResult {
  return {
    response: {
      id: 1,
      result: {
        result: {
          type: typeof value,
          value
        }
      }
    },
    events: []
  };
}
