import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./mcp-server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createMcpServer(config);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
