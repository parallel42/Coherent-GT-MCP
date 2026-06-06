import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type JsonToolResultOptions = {
  resultStore?: ToolResultStore;
  inlineMaxBytes?: number;
  previewBytes?: number;
};

export type ResultReadOptions = {
  resultId: string;
  offsetBytes?: number;
  maxBytes: number;
};

export type ResultSearchOptions = {
  resultId: string;
  query: string;
  caseSensitive?: boolean;
  isRegex?: boolean;
  maxMatches: number;
  contextChars: number;
};

type StoredToolResult = {
  id: string;
  text: string;
  bytes: number;
  createdAt: string;
};

export class ToolResultStore {
  private readonly entries = new Map<string, StoredToolResult>();
  private counter = 0;

  constructor(private readonly maxEntries = 50) {}

  put(text: string): StoredToolResult {
    const id = `result_${Date.now().toString(36)}_${(++this.counter).toString(36)}`;
    const entry = {
      id,
      text,
      bytes: Buffer.byteLength(text, "utf8"),
      createdAt: new Date().toISOString()
    };

    this.entries.set(id, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      this.entries.delete(oldest);
    }

    return entry;
  }

  read(options: ResultReadOptions): unknown {
    const entry = this.require(options.resultId);
    const offsetBytes = Math.min(options.offsetBytes ?? 0, entry.bytes);
    const chunk = byteSlice(entry.text, offsetBytes, options.maxBytes);
    const chunkBytes = Buffer.byteLength(chunk, "utf8");
    const nextOffsetBytes = offsetBytes + chunkBytes < entry.bytes ? offsetBytes + chunkBytes : null;

    return {
      resultId: entry.id,
      createdAt: entry.createdAt,
      totalBytes: entry.bytes,
      offsetBytes,
      returnedBytes: chunkBytes,
      nextOffsetBytes,
      text: chunk
    };
  }

  search(options: ResultSearchOptions): unknown {
    const entry = this.require(options.resultId);
    const matches = options.isRegex ? regexMatches(entry.text, options) : plainMatches(entry.text, options);

    return {
      resultId: entry.id,
      createdAt: entry.createdAt,
      totalBytes: entry.bytes,
      query: options.query,
      caseSensitive: options.caseSensitive ?? false,
      isRegex: options.isRegex ?? false,
      returnedMatches: matches.length,
      maxMatches: options.maxMatches,
      matches
    };
  }

  private require(resultId: string): StoredToolResult {
    const entry = this.entries.get(resultId);
    if (!entry) {
      throw new Error(`Unknown resultId: ${resultId}`);
    }
    return entry;
  }
}

export function jsonToolResult(value: unknown, maxTextBytes: number, options: JsonToolResultOptions = {}): CallToolResult {
  const text = cappedJson(value, maxTextBytes, options);
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

function cappedJson(value: unknown, maxBytes: number, options: JsonToolResultOptions): string {
  const text = JSON.stringify(value, null, 2);
  const bytes = Buffer.byteLength(text, "utf8");
  const inlineMaxBytes = Math.min(options.inlineMaxBytes ?? maxBytes, maxBytes);
  if (bytes <= inlineMaxBytes) {
    return text;
  }

  if (options.resultStore) {
    const entry = options.resultStore.put(text);
    return cachedResultEnvelope(entry, inlineMaxBytes, Math.min(options.previewBytes ?? inlineMaxBytes, maxBytes), maxBytes);
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

function cachedResultEnvelope(entry: StoredToolResult, inlineMaxBytes: number, previewBytes: number, maxBytes: number): string {
  let effectivePreviewBytes = Math.max(0, previewBytes);

  while (true) {
    const preview = byteSlice(entry.text, 0, effectivePreviewBytes);
    const payload = JSON.stringify(
      {
        partial: true,
        resultId: entry.id,
        originalBytes: entry.bytes,
        inlineResultMaxBytes: inlineMaxBytes,
        previewBytes: Buffer.byteLength(preview, "utf8"),
        preview,
        next: {
          read: {
            tool: "coherentgt_result_read",
            arguments: {
              resultId: entry.id,
              offsetBytes: Buffer.byteLength(preview, "utf8")
            }
          },
          search: {
            tool: "coherentgt_result_search",
            arguments: {
              resultId: entry.id,
              query: "<text or regex>"
            }
          }
        }
      },
      null,
      2
    );

    if (Buffer.byteLength(payload, "utf8") <= maxBytes || effectivePreviewBytes === 0) {
      return payload;
    }

    effectivePreviewBytes = Math.floor(effectivePreviewBytes / 2);
  }
}

function byteSlice(text: string, offsetBytes: number, maxBytes: number): string {
  return Buffer.from(text, "utf8")
    .subarray(offsetBytes, offsetBytes + maxBytes)
    .toString("utf8");
}

function plainMatches(text: string, options: ResultSearchOptions): unknown[] {
  const matches = [];
  const caseSensitive = options.caseSensitive ?? false;
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? options.query : options.query.toLowerCase();
  let index = 0;

  while (matches.length < options.maxMatches) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) {
      break;
    }

    matches.push(buildSearchMatch(text, found, found + options.query.length, options.contextChars));
    index = found + Math.max(needle.length, 1);
  }

  return matches;
}

function regexMatches(text: string, options: ResultSearchOptions): unknown[] {
  let regex: RegExp;
  try {
    regex = new RegExp(options.query, options.caseSensitive ? "g" : "gi");
  } catch (error) {
    throw new Error(`Invalid regex query: ${error instanceof Error ? error.message : String(error)}`);
  }

  const matches = [];
  let match: RegExpExecArray | null;
  while (matches.length < options.maxMatches && (match = regex.exec(text))) {
    matches.push(buildSearchMatch(text, match.index, match.index + match[0].length, options.contextChars));
    if (match[0].length === 0) {
      regex.lastIndex += 1;
    }
  }

  return matches;
}

function buildSearchMatch(text: string, startChar: number, endChar: number, contextChars: number): unknown {
  const location = lineColumnAt(text, startChar);
  const snippetStartChar = Math.max(0, startChar - contextChars);
  const snippetEndChar = Math.min(text.length, endChar + contextChars);

  return {
    startChar,
    endChar,
    line: location.line,
    column: location.column,
    matchText: text.slice(startChar, endChar),
    snippet: text.slice(snippetStartChar, snippetEndChar)
  };
}

function lineColumnAt(text: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;

  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}
