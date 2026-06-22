import type { InspectorCommandResult } from "../coherent/protocol.js";
import { coherentgtInspectorSession } from "./inspector.js";
import { buildClickExpression } from "./events.js";
import { normalizeEvaluateResult } from "./evaluate.js";
import { runtimeEvaluateParams } from "./runtime.js";

export type ActionActivation = "trusted-click" | "dom-click" | "element-click";
export type ActionButton = "left";

export type ActionState = {
  title?: string | undefined;
  href?: string | undefined;
  readyState?: string | undefined;
  targetText?: string | undefined;
  targetRect?: { x: number; y: number; width: number; height: number } | undefined;
};

export type ActivateInput = {
  pageId: number;
  activation: ActionActivation;
  selector?: string | undefined;
  x?: number | undefined;
  y?: number | undefined;
  button?: ActionButton | undefined;
  postconditionExpression?: string | undefined;
  postDelayMs?: number | undefined;
};

type InspectorSend = (method: string, params?: object) => Promise<InspectorCommandResult>;

type DispatchResult = {
  dispatched: boolean;
  method: string;
  coordinates?: { x: number; y: number } | undefined;
  result?: unknown;
  error?: string | undefined;
};

type PostconditionResult = {
  evaluated: boolean;
  ok?: boolean | undefined;
  value?: unknown;
  error?: string | undefined;
};

export async function coherentgtClickAt(options: {
  debuggerUrl: string;
  pageId: number;
  timeoutMs: number;
  x: number;
  y: number;
  button: ActionButton;
  postDelayMs: number;
}): Promise<unknown> {
  return await coherentgtInspectorSession(options, (send) =>
    activateWithInspectorSend(send, {
      pageId: options.pageId,
      activation: "trusted-click",
      x: options.x,
      y: options.y,
      button: options.button,
      postDelayMs: options.postDelayMs
    })
  );
}

export async function coherentgtActivate(
  options: {
    debuggerUrl: string;
    pageId: number;
    timeoutMs: number;
  },
  input: ActivateInput
): Promise<unknown> {
  return await coherentgtInspectorSession(options, (send) => activateWithInspectorSend(send, input));
}

export async function activateWithInspectorSend(send: InspectorSend, input: ActivateInput): Promise<Record<string, unknown>> {
  const warnings: string[] = [];
  const before = await readActionState(send, input.selector);
  const dispatch = await dispatchActivation(send, input, before);

  if (!dispatch.dispatched) {
    if (input.activation === "trusted-click") {
      warnings.push("Trusted pointer input is not supported by this Coherent WebInspector target.");
    }
    return compactUndefined({
      pageId: input.pageId,
      activation: input.activation,
      dispatch,
      postcondition: { evaluated: false },
      stateChange: { before },
      warnings: warnings.length > 0 ? warnings : undefined
    });
  }

  if ((input.postDelayMs ?? 0) > 0) {
    await delay(input.postDelayMs ?? 0);
  }

  const postcondition = input.postconditionExpression
    ? await evaluatePostcondition(send, input.postconditionExpression)
    : { evaluated: false };
  const after = await readActionState(send, input.selector);
  const stateChange = summarizeActionState(before, after);

  if (stateChange.noStateChange && postcondition.ok !== true) {
    warnings.push("Target text and page identity were unchanged after activation; action may have been ignored by native Coherent UI.");
  }

  return compactUndefined({
    pageId: input.pageId,
    activation: input.activation,
    dispatch,
    postcondition,
    pageReachableAfter: true,
    stateChange,
    warnings: warnings.length > 0 ? warnings : undefined
  });
}

export function summarizeActionState(before: ActionState, after: ActionState): Record<string, unknown> {
  return {
    before,
    after,
    noStateChange:
      before.title === after.title &&
      before.href === after.href &&
      before.readyState === after.readyState &&
      before.targetText === after.targetText
  };
}

async function dispatchActivation(send: InspectorSend, input: ActivateInput, before: ActionState): Promise<DispatchResult> {
  if (input.activation === "trusted-click") {
    const coordinates = resolveCoordinates(input, before);
    if (!coordinates) {
      return { dispatched: false, method: "Input.dispatchMouseEvent", error: "No click coordinates or target rect were available" };
    }

    const pressed = await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: coordinates.x,
      y: coordinates.y,
      button: input.button ?? "left",
      clickCount: 1
    });
    if (pressed.response.error) {
      return { dispatched: false, method: "Input.dispatchMouseEvent", coordinates, error: pressed.response.error.message };
    }

    const released = await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: coordinates.x,
      y: coordinates.y,
      button: input.button ?? "left",
      clickCount: 1
    });
    if (released.response.error) {
      return { dispatched: false, method: "Input.dispatchMouseEvent", coordinates, error: released.response.error.message };
    }

    return { dispatched: true, method: "Input.dispatchMouseEvent", coordinates };
  }

  if (!input.selector) {
    return { dispatched: false, method: "Runtime.evaluate", error: `${input.activation} requires selector` };
  }

  const expression =
    input.activation === "dom-click" ? buildClickExpression(input.selector) : buildElementClickExpression(input.selector);
  const result = normalizeEvaluateResult(
    await send(
      "Runtime.evaluate",
      runtimeEvaluateParams({
        expression,
        awaitPromise: false,
        returnByValue: true
      })
    )
  );

  if (result.wasThrown) {
    return { dispatched: false, method: "Runtime.evaluate", result, error: result.exception?.text ?? result.description };
  }

  const value = readRecord(result.value);
  const dispatched = value.clicked === true || value.invoked === true;
  return { dispatched, method: "Runtime.evaluate", result: result.value };
}

async function readActionState(send: InspectorSend, selector?: string | undefined): Promise<ActionState> {
  const result = normalizeEvaluateResult(
    await send(
      "Runtime.evaluate",
      runtimeEvaluateParams({
        expression: buildActionStateExpression(selector),
        awaitPromise: false,
        returnByValue: true
      })
    )
  );
  return toActionState(result.value);
}

async function evaluatePostcondition(send: InspectorSend, expression: string): Promise<PostconditionResult> {
  const result = normalizeEvaluateResult(
    await send(
      "Runtime.evaluate",
      runtimeEvaluateParams({
        expression,
        awaitPromise: true,
        returnByValue: true
      })
    )
  );

  if (result.wasThrown) {
    return { evaluated: true, ok: false, error: result.exception?.text ?? result.description };
  }

  const record = readRecord(result.value);
  return {
    evaluated: true,
    ok: result.value === true || record.ok === true,
    value: result.value
  };
}

function buildActionStateExpression(selector?: string | undefined): string {
  return `(() => {
  var selector = ${selector === undefined ? "null" : JSON.stringify(selector)};
  var target = selector ? document.querySelector(selector) : null;
  var rect = target && typeof target.getBoundingClientRect === "function" ? target.getBoundingClientRect() : null;
  return {
    title: document.title,
    href: location.href,
    readyState: document.readyState,
    targetText: target ? target.textContent : undefined,
    targetRect: rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : undefined
  };
})()`;
}

function buildElementClickExpression(selector: string): string {
  return `(() => {
  var selector = ${JSON.stringify(selector)};
  var element = document.querySelector(selector);
  if (!element) return { selector: selector, invoked: false, reason: "No element matched selector" };
  if (typeof element.click !== "function") return { selector: selector, invoked: false, reason: "element.click is unavailable" };
  element.click();
  return { selector: selector, invoked: true };
})()`;
}

function resolveCoordinates(input: ActivateInput, state: ActionState): { x: number; y: number } | undefined {
  if (typeof input.x === "number" && typeof input.y === "number") {
    return { x: input.x, y: input.y };
  }
  if (!state.targetRect) {
    return undefined;
  }
  return {
    x: state.targetRect.x + state.targetRect.width / 2,
    y: state.targetRect.y + state.targetRect.height / 2
  };
}

function toActionState(value: unknown): ActionState {
  const record = readRecord(value);
  const rect = readRecord(record.targetRect);
  const output: ActionState = {};
  if (typeof record.title === "string") output.title = record.title;
  if (typeof record.href === "string") output.href = record.href;
  if (typeof record.readyState === "string") output.readyState = record.readyState;
  if (typeof record.targetText === "string") output.targetText = record.targetText;
  if (
    typeof rect.x === "number" &&
    typeof rect.y === "number" &&
    typeof rect.width === "number" &&
    typeof rect.height === "number"
  ) {
    output.targetRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }
  return output;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function compactUndefined(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      output[key] = entry;
    }
  }
  return output;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
