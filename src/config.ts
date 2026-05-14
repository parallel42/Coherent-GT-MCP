export type AppConfig = {
  debuggerUrl: string;
  requestTimeoutMs: number;
  wsTimeoutMs: number;
  maxTextBytes: number;
};

const DEFAULTS: AppConfig = {
  debuggerUrl: "http://host.docker.internal:19999",
  requestTimeoutMs: 5000,
  wsTimeoutMs: 10000,
  maxTextBytes: 262144
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    debuggerUrl: normalizeBaseUrl(env.COHERENT_GT_DEBUGGER_URL ?? DEFAULTS.debuggerUrl),
    requestTimeoutMs: parsePositiveInt(
      env.COHERENT_GT_REQUEST_TIMEOUT_MS,
      DEFAULTS.requestTimeoutMs,
      "COHERENT_GT_REQUEST_TIMEOUT_MS"
    ),
    wsTimeoutMs: parsePositiveInt(env.COHERENT_GT_WS_TIMEOUT_MS, DEFAULTS.wsTimeoutMs, "COHERENT_GT_WS_TIMEOUT_MS"),
    maxTextBytes: parsePositiveInt(
      env.COHERENT_GT_MAX_TEXT_BYTES,
      DEFAULTS.maxTextBytes,
      "COHERENT_GT_MAX_TEXT_BYTES"
    )
  };
}

export function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function parsePositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}
