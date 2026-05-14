import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function jsonToolResult(value: unknown, maxTextBytes: number): CallToolResult {
  const text = cappedJson(value, maxTextBytes);
  return {
    content: [
      {
        type: "text",
        text
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

function cappedJson(value: unknown, maxBytes: number): string {
  const text = JSON.stringify(value, null, 2);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) {
    return text;
  }

  const preview = Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8");
  return JSON.stringify(
    {
      truncated: true,
      originalBytes: bytes,
      maxTextBytes: maxBytes,
      preview
    },
    null,
    2
  );
}
