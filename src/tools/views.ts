import type { CoherentDebuggerClient } from "../coherent/debugger-client.js";

export async function coherentgtListViews(client: CoherentDebuggerClient): Promise<unknown> {
  return await client.listViews();
}
