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

export function buildEngineDiagnosticsExpression(): string {
  return `(() => {
  function ownKeys(value) {
    var keys = [];
    if (!value) return keys;
    for (var key in value) keys.push(key);
    return keys.sort();
  }
  function typeOfPath(root, path) {
    var value = root;
    for (var i = 0; i < path.length; i += 1) {
      if (value == null) return { available: false, type: "undefined" };
      value = value[path[i]];
    }
    return { available: value !== undefined, type: typeof value };
  }
  var engineObject = globalThis.engine;
  var engineEvents = engineObject && engineObject.events;
  return {
    page: {
      title: document.title,
      href: location.href,
      readyState: document.readyState
    },
    engine: {
      exists: !!engineObject,
      type: typeof engineObject,
      keys: ownKeys(engineObject),
      eventsType: typeof engineEvents,
      eventKeys: ownKeys(engineEvents),
      call: typeOfPath(globalThis, ["engine", "call"]),
      trigger: typeOfPath(globalThis, ["engine", "trigger"])
    },
    nativeBridge: {
      TriggerEvent: typeOfPath(globalThis, ["TriggerEvent"]),
      SendMessage: typeOfPath(globalThis, ["SendMessage"]),
      Coherent: typeOfPath(globalThis, ["Coherent"])
    }
  };
})()`;
}

declare global {
  // Coherent GT pages expose this bridge at runtime. The MCP server only emits code strings for it.
  // eslint-disable-next-line no-var
  var engine: unknown;
}
