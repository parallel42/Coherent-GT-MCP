export function runtimeEvaluateParams(options: {
  expression: string;
  awaitPromise?: boolean;
  returnByValue?: boolean;
}): Record<string, unknown> {
  return {
    expression: options.expression,
    awaitPromise: options.awaitPromise ?? false,
    returnByValue: options.returnByValue ?? true
  };
}

export function buildEngineTriggerExpression(eventName: string, args: unknown[] = []): string {
  return `(() => {
  const engineObject = globalThis.engine;
  if (!engineObject || typeof engineObject.trigger !== "function") {
    throw new Error("engine.trigger is unavailable");
  }
  return engineObject.trigger(${JSON.stringify(eventName)}, ...${JSON.stringify(args)});
})()`;
}

export function buildEngineCallExpression(functionName: string, args: unknown[] = []): string {
  return `(() => {
  const engineObject = globalThis.engine;
  if (!engineObject || typeof engineObject.call !== "function") {
    throw new Error("engine.call is unavailable");
  }
  return engineObject.call(${JSON.stringify(functionName)}, ...${JSON.stringify(args)});
})()`;
}

declare global {
  // Coherent GT pages expose this bridge at runtime. The MCP server only emits code strings for it.
  // eslint-disable-next-line no-var
  var engine: unknown;
}
