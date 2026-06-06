import type { CoherentDebuggerClient } from "../coherent/debugger-client.js";
import type { InspectableView } from "../coherent/protocol.js";

export type PageFilter = {
  titleContains?: string | undefined;
  urlContains?: string | undefined;
};

export type PageSummary = {
  id: number;
  title: string;
  url: string;
  inspectorUrl: string;
  websocketUrl: string;
};

export async function coherentgtListPages(
  client: CoherentDebuggerClient,
  debuggerUrl: string,
  filter: PageFilter = {}
): Promise<PageSummary[]> {
  const views = await client.listViews();
  return filterInspectableViews(views, filter).map((view) => toPageSummary(debuggerUrl, view));
}

export function filterInspectableViews(views: InspectableView[], filter: PageFilter): InspectableView[] {
  const titleNeedle = filter.titleContains?.toLowerCase();
  const urlNeedle = filter.urlContains?.toLowerCase();

  return views.filter((view) => {
    if (titleNeedle && !view.title.toLowerCase().includes(titleNeedle)) {
      return false;
    }
    if (urlNeedle && !view.url.toLowerCase().includes(urlNeedle)) {
      return false;
    }
    return true;
  });
}

export function toPageSummary(debuggerUrl: string, view: InspectableView): PageSummary {
  return {
    id: view.id,
    title: view.title,
    url: view.url,
    inspectorUrl: normalizeInspectorUrl(debuggerUrl, view.inspectorUrl),
    websocketUrl: view.websocketUrl
  };
}

export function normalizeInspectorUrl(debuggerUrl: string, inspectorUrl: string): string {
  if (inspectorUrl.trim() === "") {
    return "";
  }
  return new URL(inspectorUrl, `${debuggerUrl}/`).toString();
}
