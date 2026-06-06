import { buildWebsocketUrl } from "../coherent/debugger-client.js";
import { isRetriableInspectorError, sendInspectorCommand, withInspectorSession } from "../coherent/inspector-client.js";
import type { InspectorCommandResult } from "../coherent/protocol.js";
import { assertPageId } from "../coherent/view-selector.js";

const pageCommandQueues = new Map<string, Promise<void>>();

export async function coherentgtInspectorCommand(options: {
  debuggerUrl: string;
  pageId: number;
  method: string;
  params?: object | undefined;
  timeoutMs: number;
}): Promise<unknown> {
  const websocketUrl = buildWebsocketUrl(options.debuggerUrl, assertPageId(options.pageId));
  return await enqueueInspectorCommand(websocketUrl, async () => {
    const commandOptions: {
      websocketUrl: string;
      method: string;
      timeoutMs: number;
      params?: object;
    } = {
      websocketUrl,
      method: options.method,
      timeoutMs: options.timeoutMs
    };

    if (options.params !== undefined) {
      commandOptions.params = options.params;
    }

    return await sendInspectorCommand(commandOptions);
  });
}

async function enqueueInspectorCommand<T>(websocketUrl: string, fn: () => Promise<T>): Promise<T> {
  const previous = pageCommandQueues.get(websocketUrl) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });

  pageCommandQueues.set(
    websocketUrl,
    previous
      .catch(() => undefined)
      .then(() => current)
      .finally(() => {
        if (pageCommandQueues.get(websocketUrl) === current) {
          pageCommandQueues.delete(websocketUrl);
        }
      })
  );

  await previous.catch(() => undefined);

  try {
    return await fn();
  } finally {
    release();
  }
}

export async function coherentgtInspectorSession<T>(
  options: {
    debuggerUrl: string;
    pageId: number;
    timeoutMs: number;
  },
  fn: (send: (method: string, params?: object) => Promise<InspectorCommandResult>) => Promise<T>
): Promise<T> {
  const websocketUrl = buildWebsocketUrl(options.debuggerUrl, assertPageId(options.pageId));
  return await enqueueInspectorCommand(websocketUrl, () =>
    retryRetriable(() =>
      withInspectorSession(
        {
          websocketUrl,
          timeoutMs: options.timeoutMs
        },
        fn
      )
    )
  );
}

async function retryRetriable<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isRetriableInspectorError(error)) {
      throw error;
    }
    return await fn();
  }
}
