import { describe, expect, it } from "vitest";
import { normalizeEvaluateResult, normalizeInspectorError } from "../../src/tools/evaluate.js";

describe("normalized evaluate results", () => {
  it("flattens successful Runtime.evaluate results", () => {
    expect(
      normalizeEvaluateResult({
        response: {
          id: 1,
          result: {
            result: {
              type: "object",
              value: { readyState: "complete" },
              description: "Object"
            },
            wasThrown: false
          }
        },
        events: []
      })
    ).toMatchObject({
      type: "object",
      value: { readyState: "complete" },
      description: "Object",
      wasThrown: false
    });
  });

  it("extracts thrown exception text and stack frames", () => {
    expect(
      normalizeEvaluateResult({
        response: {
          id: 1,
          result: {
            result: {
              type: "object",
              description: "ReferenceError: missing"
            },
            wasThrown: true,
            exceptionDetails: {
              text: "ReferenceError: missing",
              url: "coui://app.js",
              line: 0,
              column: 10,
              stackTrace: {
                callFrames: [{ functionName: "loop", url: "coui://app.js", lineNumber: 0, columnNumber: 10 }]
              }
            }
          }
        },
        events: []
      })
    ).toMatchObject({
      wasThrown: true,
      exception: {
        text: "ReferenceError: missing",
        url: "coui://app.js",
        line: 0,
        column: 10
      },
      stackFrames: [{ functionName: "loop", url: "coui://app.js", lineNumber: 0, columnNumber: 10 }]
    });
  });

  it("surfaces inspector command errors", () => {
    expect(
      normalizeEvaluateResult({
        response: {
          id: 1,
          error: { message: "Runtime.evaluate failed" }
        },
        events: []
      })
    ).toEqual({
      wasThrown: true,
      type: "error",
      value: undefined,
      description: "Runtime.evaluate failed",
      exception: { text: "Runtime.evaluate failed" },
      stackFrames: []
    });
  });

  it("normalizes Runtime.evaluate timeouts as main-thread busy candidates", () => {
    expect(
      normalizeInspectorError(new Error("Timed out after 1500ms waiting for Runtime.evaluate"), {
        method: "Runtime.evaluate",
        timeoutMs: 1500
      })
    ).toEqual({
      wasThrown: true,
      type: "timeout",
      value: undefined,
      description: "Timed out after 1500ms waiting for Runtime.evaluate",
      exception: { text: "Timed out after 1500ms waiting for Runtime.evaluate" },
      stackFrames: [],
      timing: { timeoutMs: 1500 },
      likelyCause: "main-thread-busy"
    });
  });
});
