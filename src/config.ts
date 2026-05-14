export type AppConfig = {
  transport: "stdio" | "http";
  debuggerUrl: string;
  requestTimeoutMs: number;
  wsTimeoutMs: number;
  maxTextBytes: number;
  idleTimeoutMs: number;
  httpHost: string;
  httpPort: number;
  httpPath: string;
};

const DEFAULTS: AppConfig = {
  transport: "stdio",
  debuggerUrl: "http://host.docker.internal:19999",
  requestTimeoutMs: 5000,
  wsTimeoutMs: 30000,
  maxTextBytes: 262144,
  idleTimeoutMs: 3000000,
  httpHost: "0.0.0.0",
  httpPort: 3333,
  httpPath: "/mcp"
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    transport: parseTransport(env.COHERENT_GT_TRANSPORT, DEFAULTS.transport),
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
    ),
    idleTimeoutMs: parseNonNegativeInt(
      env.COHERENT_GT_IDLE_TIMEOUT_MS,
      DEFAULTS.idleTimeoutMs,
      "COHERENT_GT_IDLE_TIMEOUT_MS"
    ),
    httpHost: env.COHERENT_GT_HTTP_HOST ?? DEFAULTS.httpHost,
    httpPort: parsePositiveInt(env.COHERENT_GT_HTTP_PORT, DEFAULTS.httpPort, "COHERENT_GT_HTTP_PORT"),
    httpPath: normalizeHttpPath(env.COHERENT_GT_HTTP_PATH ?? DEFAULTS.httpPath)
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

function parseTransport(value: string | undefined, fallback: AppConfig["transport"]): AppConfig["transport"] {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  if (value === "stdio" || value === "http") {
    return value;
  }

  throw new Error("COHERENT_GT_TRANSPORT must be either stdio or http");
}

function normalizeHttpPath(value: string): string {
  const trimmed = value.trim();

  if (trimmed === "" || trimmed === "/") {
    return "/mcp";
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function parseNonNegativeInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return parsed;
}
