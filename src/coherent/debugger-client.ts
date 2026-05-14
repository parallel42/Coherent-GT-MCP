import { z } from "zod";
import type { InspectableView, RawPageListEntry } from "./protocol.js";

const rawPageListEntrySchema = z.object({
  id: z.union([z.number().int(), z.string().regex(/^\d+$/)]),
  title: z.string().optional().default(""),
  url: z.string().optional().default(""),
  inspectorUrl: z.string().optional().default("")
});

const rawPageListSchema = z.array(rawPageListEntrySchema);

export type HealthResult = {
  targetUrl: string;
  reachable: boolean;
  pageCount: number;
  error?: string;
};

export class CoherentDebuggerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number
  ) {}

  async health(): Promise<HealthResult> {
    try {
      await this.fetchText("/");
      const views = await this.listViews();
      return {
        targetUrl: this.baseUrl,
        reachable: true,
        pageCount: views.length
      };
    } catch (error) {
      return {
        targetUrl: this.baseUrl,
        reachable: false,
        pageCount: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async listViews(): Promise<InspectableView[]> {
    const response = await this.fetchJson<unknown>("/pagelist.json");
    const entries = rawPageListSchema.parse(response);
    return entries.map((entry) => toInspectableView(this.baseUrl, entry));
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const text = await this.fetchText(path);
    return JSON.parse(text) as T;
  }

  private async fetchText(path: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(new URL(path, `${this.baseUrl}/`), {
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Coherent debugger returned HTTP ${response.status} for ${path}`);
      }

      return await response.text();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Timed out after ${this.timeoutMs}ms fetching ${path}`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function toInspectableView(baseUrl: string, entry: RawPageListEntry): InspectableView {
  const parsed = rawPageListEntrySchema.parse(entry);
  const id = Number(parsed.id);

  return {
    id,
    title: parsed.title,
    url: parsed.url,
    inspectorUrl: parsed.inspectorUrl,
    websocketUrl: buildWebsocketUrl(baseUrl, id)
  };
}

export function buildWebsocketUrl(baseUrl: string, pageId: number): string {
  if (!Number.isInteger(pageId) || pageId < 0) {
    throw new Error("pageId must be a non-negative integer");
  }

  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/devtools/page/${pageId}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
