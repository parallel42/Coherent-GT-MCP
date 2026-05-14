import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function jsonToolResult(value: unknown, maxTextBytes: number): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: capText(JSON.stringify(value, null, 2), maxTextBytes)
      }
    ]
  };
}

export function capText(value: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= maxBytes) {
    return value;
  }

  const suffix = `\n\n[truncated to ${maxBytes} bytes from ${bytes} bytes]`;
  return Buffer.from(value, "utf8").subarray(0, Math.max(0, maxBytes - Buffer.byteLength(suffix))).toString("utf8") + suffix;
}
